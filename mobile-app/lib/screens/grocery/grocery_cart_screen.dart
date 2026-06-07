import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/theme.dart';
import '../../core/constants.dart';
import '../../providers/grocery_provider.dart';
import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';
import '../../models/customer.dart';

class GroceryCartScreen extends StatefulWidget {
  const GroceryCartScreen({super.key});

  @override
  State<GroceryCartScreen> createState() => _GroceryCartScreenState();
}

class _GroceryCartScreenState extends State<GroceryCartScreen> {
  final _addressController = TextEditingController();
  final _couponController = TextEditingController();
  String? _selectedAddressId;
  bool _useNewAddress = false;
  String _selectedCity = '';
  bool _isPlacing = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthProvider>();
    final customer = auth.customer;
    if (customer != null) {
      _selectedCity = customer.city;
      final defaultAddr = customer.defaultAddress;
      if (defaultAddr != null && defaultAddr.id != null) {
        _selectedAddressId = defaultAddr.id.toString();
      } else {
        _useNewAddress = true;
      }
    } else {
      _useNewAddress = true;
    }
  }

  @override
  void dispose() {
    _addressController.dispose();
    _couponController.dispose();
    super.dispose();
  }

  Future<void> _placeOrder() async {
    final grocery = context.read<GroceryProvider>();
    final auth = context.read<AuthProvider>();

    if (grocery.cartIsEmpty) {
      setState(() => _error = 'Your cart is empty.');
      return;
    }
    if (grocery.cartSubtotal < grocery.minOrder) {
      setState(() => _error = 'Minimum order is ₹${grocery.minOrder.round()}.');
      return;
    }

    String addressLine = '';
    String? addressId;

    if (_useNewAddress || _selectedAddressId == null) {
      addressLine = _addressController.text.trim();
      if (addressLine.isEmpty) {
        setState(() => _error = 'Please enter a delivery address.');
        return;
      }
    } else {
      addressId = _selectedAddressId;
      final addr = auth.customer?.addresses.firstWhere(
        (a) => a.id.toString() == _selectedAddressId,
        orElse: () => Address(addressLine: ''),
      );
      addressLine = addr?.addressLine ?? '';
    }

    setState(() { _isPlacing = true; _error = null; });

    try {
      final payload = <String, dynamic>{
        'storeId': grocery.cart.first.venueId,
        'items': grocery.cart.map((l) => {'productId': l.productId, 'quantity': l.quantity, 'name': l.name}).toList(),
        'total': grocery.cartTotal.round(),
        'couponCode': grocery.couponCode ?? '',
      };

      if (addressId != null) {
        payload['addressId'] = addressId;
      } else {
        payload['address'] = {'label': 'Delivery', 'addressLine': addressLine, 'city': _selectedCity};
      }

      final result = await ApiService().placeGroceryOrder(payload);

      if (!mounted) return;
      grocery.clearCart();

      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (_) => AlertDialog(
          backgroundColor: AppTheme.surface,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.check_circle_rounded, color: AppTheme.primary, size: 64),
              const SizedBox(height: 16),
              const Text('Order Placed! 🎉', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: AppTheme.textPrimary)),
              const SizedBox(height: 8),
              Text('Order #${result['orderId'] ?? ''}', style: const TextStyle(fontSize: 14, color: AppTheme.textSecondary)),
              const SizedBox(height: 16),
              const Text('Your grocery order has been received.', textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
            ],
          ),
          actions: [
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {
                  Navigator.pop(context);
                  Navigator.pop(context);
                },
                child: const Text('Done'),
              ),
            ),
          ],
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _isPlacing = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final grocery = context.watch<GroceryProvider>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Grocery Cart'),
        leading: IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => Navigator.pop(context)),
      ),
      body: grocery.cartIsEmpty
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.shopping_basket_outlined, size: 64, color: AppTheme.textMuted),
                  const SizedBox(height: 16),
                  const Text('Your grocery cart is empty', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: AppTheme.textPrimary)),
                  const SizedBox(height: 24),
                  ElevatedButton(onPressed: () => Navigator.pop(context), child: const Text('Browse Grocery')),
                ],
              ),
            )
          : Column(
              children: [
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      // Cart items
                      ...grocery.cart.asMap().entries.map((entry) {
                        final item = entry.value;
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(item.name, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppTheme.textPrimary)),
                                    Text('${item.unitLabel} · ₹${item.price.round()}', style: const TextStyle(fontSize: 12, color: AppTheme.textMuted)),
                                  ],
                                ),
                              ),
                              _buildStepper(grocery, item),
                              const SizedBox(width: 12),
                              SizedBox(width: 55, child: Text('₹${item.lineTotal.round()}', textAlign: TextAlign.end, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppTheme.textPrimary))),
                            ],
                          ),
                        );
                      }),

                      const Divider(color: AppTheme.cardBorder),

                      // Address
                      const SizedBox(height: 12),
                      const Text('Delivery Address', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppTheme.textPrimary)),
                      const SizedBox(height: 8),

                      if ((auth.customer?.addresses ?? []).isNotEmpty)
                        ...auth.customer!.addresses.map((addr) => RadioListTile<String>(
                          value: addr.id.toString(),
                          groupValue: _useNewAddress ? '__new__' : _selectedAddressId,
                          onChanged: (val) => setState(() { _selectedAddressId = val; _useNewAddress = false; }),
                          title: Text(addr.displayLine, style: const TextStyle(fontSize: 13, color: AppTheme.textPrimary)),
                          activeColor: AppTheme.primary,
                          contentPadding: EdgeInsets.zero,
                          dense: true,
                        )),

                      if (_useNewAddress || (auth.customer?.addresses ?? []).isEmpty)
                        TextField(
                          controller: _addressController,
                          style: const TextStyle(color: AppTheme.textPrimary),
                          decoration: const InputDecoration(hintText: 'House no., street, landmark'),
                        ),

                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        value: _selectedCity.isEmpty ? null : _selectedCity,
                        decoration: const InputDecoration(labelText: 'City'),
                        dropdownColor: AppTheme.surface,
                        style: const TextStyle(color: AppTheme.textPrimary, fontSize: 15),
                        items: AppConstants.cities.map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
                        onChanged: (val) => setState(() => _selectedCity = val ?? ''),
                      ),

                      // Coupon
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          Expanded(child: TextField(
                            controller: _couponController,
                            style: const TextStyle(color: AppTheme.textPrimary),
                            decoration: const InputDecoration(hintText: 'Coupon code'),
                          )),
                          const SizedBox(width: 8),
                          ElevatedButton(
                            onPressed: () => grocery.applyCoupon(_couponController.text.trim()),
                            style: ElevatedButton.styleFrom(minimumSize: const Size(70, 48)),
                            child: const Text('Apply'),
                          ),
                        ],
                      ),
                      if (grocery.couponMessage != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text(grocery.couponMessage!, style: TextStyle(fontSize: 12, color: grocery.couponError ? AppTheme.errorLight : AppTheme.primary)),
                        ),

                      if (_error != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: Text(_error!, style: const TextStyle(fontSize: 13, color: AppTheme.errorLight)),
                        ),

                      const SizedBox(height: 60),
                    ],
                  ),
                ),

                // Bottom
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppTheme.surface,
                    border: const Border(top: BorderSide(color: AppTheme.cardBorder)),
                  ),
                  child: SafeArea(
                    top: false,
                    child: Column(
                      children: [
                        _row('Subtotal', '₹${grocery.cartSubtotal.round()}'),
                        if (grocery.couponDiscount > 0) _row('Discount', '-₹${grocery.couponDiscount.round()}', highlight: true),
                        _row(grocery.cartDeliveryFee == 0 ? 'Delivery' : 'Delivery', grocery.cartDeliveryFee == 0 ? 'FREE' : '₹${grocery.cartDeliveryFee.round()}', highlight: grocery.cartDeliveryFee == 0),
                        const Divider(height: 16, color: AppTheme.cardBorder),
                        _row('Total', '₹${grocery.cartTotal.round()}', bold: true),
                        const SizedBox(height: 12),
                        SizedBox(
                          width: double.infinity,
                          height: 50,
                          child: ElevatedButton(
                            onPressed: _isPlacing ? null : _placeOrder,
                            child: _isPlacing
                                ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                                : Text('Place Order · ₹${grocery.cartTotal.round()}'),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildStepper(GroceryProvider grocery, dynamic item) {
    return Container(
      height: 30,
      decoration: BoxDecoration(color: AppTheme.primary, borderRadius: BorderRadius.circular(6)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          InkWell(onTap: () => grocery.decrementCartItem(item.productId), child: const SizedBox(width: 30, height: 30, child: Center(child: Text('−', style: TextStyle(fontSize: 14, color: Colors.white, fontWeight: FontWeight.w600))))),
          SizedBox(width: 24, child: Center(child: Text('${item.quantity}', style: const TextStyle(fontSize: 13, color: Colors.white, fontWeight: FontWeight.w700)))),
          InkWell(onTap: () => grocery.incrementCartItem(item.productId), child: const SizedBox(width: 30, height: 30, child: Center(child: Text('+', style: TextStyle(fontSize: 14, color: Colors.white, fontWeight: FontWeight.w600))))),
        ],
      ),
    );
  }

  Widget _row(String label, String value, {bool bold = false, bool highlight = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(fontSize: bold ? 15 : 13, fontWeight: bold ? FontWeight.w700 : FontWeight.w500, color: bold ? AppTheme.textPrimary : AppTheme.textSecondary)),
          Text(value, style: TextStyle(fontSize: bold ? 15 : 13, fontWeight: bold ? FontWeight.w700 : FontWeight.w600, color: highlight ? AppTheme.primary : (bold ? AppTheme.textPrimary : AppTheme.textSecondary))),
        ],
      ),
    );
  }
}
