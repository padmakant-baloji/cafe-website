import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/theme.dart';
import '../../core/constants.dart';
import '../../providers/auth_provider.dart';
import '../../providers/cart_provider.dart';
import '../../services/api_service.dart';
import '../../models/customer.dart';

class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key});

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
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
    final cart = context.read<CartProvider>();
    final auth = context.read<AuthProvider>();

    if (cart.isEmpty) {
      setState(() => _error = 'Your cart is empty.');
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

    if (_selectedCity.isEmpty) {
      setState(() => _error = 'Please select your city.');
      return;
    }

    setState(() {
      _isPlacing = true;
      _error = null;
    });

    try {
      final payload = cart.buildOrderPayload(
        addressLine: addressLine,
        city: _selectedCity,
        addressId: addressId,
      );

      final result = await ApiService().placeOrder(payload);

      if (!mounted) return;

      cart.clear();

      // Show success
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
              const Text(
                'Order Placed! 🎉',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: AppTheme.textPrimary),
              ),
              const SizedBox(height: 8),
              Text(
                'Order #${result['orderId'] ?? ''}',
                style: const TextStyle(fontSize: 14, color: AppTheme.textSecondary),
              ),
              if (result['venueName'] != null && result['venueName'].toString().isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  result['venueName'].toString(),
                  style: const TextStyle(fontSize: 13, color: AppTheme.textMuted),
                ),
              ],
              const SizedBox(height: 16),
              const Text(
                'Your order has been received. Track progress in My Orders.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
              ),
            ],
          ),
          actions: [
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {
                  Navigator.pop(context); // Close dialog
                  Navigator.pop(context); // Close checkout
                  Navigator.pop(context); // Close cart
                },
                child: const Text('Track My Orders'),
              ),
            ),
          ],
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _isPlacing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final cart = context.watch<CartProvider>();
    final customer = auth.customer;
    final addresses = customer?.addresses ?? [];

    return Scaffold(
      appBar: AppBar(title: const Text('Checkout')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Customer info
            _buildSection('Customer', [
              _buildInfoRow('Name', customer?.name ?? '-'),
              _buildInfoRow('Mobile', customer?.mobile ?? '-'),
            ]),

            const SizedBox(height: 16),

            // Delivery address
            _buildSectionHeader('Delivery Address'),
            const SizedBox(height: 8),

            if (addresses.isNotEmpty) ...[
              ...addresses.map((addr) => RadioListTile<String>(
                value: addr.id.toString(),
                groupValue: _useNewAddress ? '__new__' : _selectedAddressId,
                onChanged: (val) => setState(() {
                  _selectedAddressId = val;
                  _useNewAddress = false;
                  _selectedCity = addr.city.isNotEmpty ? addr.city : _selectedCity;
                }),
                title: Text(
                  addr.displayLine.isNotEmpty ? addr.displayLine : 'Saved address',
                  style: const TextStyle(fontSize: 14, color: AppTheme.textPrimary),
                ),
                subtitle: Row(
                  children: [
                    if (addr.city.isNotEmpty)
                      Text(addr.city, style: const TextStyle(fontSize: 12, color: AppTheme.textMuted)),
                    if (addr.isDefault) ...[
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: AppTheme.primary.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: const Text('Default', style: TextStyle(fontSize: 10, color: AppTheme.primary, fontWeight: FontWeight.w600)),
                      ),
                    ],
                  ],
                ),
                activeColor: AppTheme.primary,
                contentPadding: EdgeInsets.zero,
                dense: true,
              )),
              RadioListTile<String>(
                value: '__new__',
                groupValue: _useNewAddress ? '__new__' : _selectedAddressId,
                onChanged: (_) => setState(() => _useNewAddress = true),
                title: const Text(
                  'Use a new address',
                  style: TextStyle(fontSize: 14, color: AppTheme.textPrimary),
                ),
                subtitle: const Text('Type a street or landmark', style: TextStyle(fontSize: 12, color: AppTheme.textMuted)),
                activeColor: AppTheme.primary,
                contentPadding: EdgeInsets.zero,
                dense: true,
              ),
            ],

            if (_useNewAddress || addresses.isEmpty) ...[
              const SizedBox(height: 8),
              TextField(
                controller: _addressController,
                textCapitalization: TextCapitalization.sentences,
                style: const TextStyle(color: AppTheme.textPrimary),
                decoration: const InputDecoration(
                  hintText: 'House no., street, landmark',
                  labelText: 'Address',
                ),
              ),
            ],

            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              value: _selectedCity.isEmpty ? null : _selectedCity,
              decoration: const InputDecoration(labelText: 'City'),
              dropdownColor: AppTheme.surface,
              style: const TextStyle(color: AppTheme.textPrimary, fontSize: 15),
              items: AppConstants.cities.map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
              onChanged: (val) => setState(() => _selectedCity = val ?? ''),
            ),

            const SizedBox(height: 24),

            // Coupon
            _buildSectionHeader('Coupon Code'),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _couponController,
                    textCapitalization: TextCapitalization.characters,
                    style: const TextStyle(color: AppTheme.textPrimary),
                    decoration: const InputDecoration(hintText: 'Enter code'),
                  ),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: () => cart.applyCoupon(_couponController.text.trim()),
                  style: ElevatedButton.styleFrom(minimumSize: const Size(80, 48)),
                  child: const Text('Apply'),
                ),
              ],
            ),
            if (cart.couponMessage != null) ...[
              const SizedBox(height: 6),
              Text(
                cart.couponMessage!,
                style: TextStyle(
                  fontSize: 13,
                  color: cart.couponError ? AppTheme.errorLight : AppTheme.primary,
                ),
              ),
            ],

            const SizedBox(height: 24),

            // Order summary
            _buildSectionHeader('Order Summary'),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppTheme.surface,
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                border: Border.all(color: AppTheme.cardBorder),
              ),
              child: Column(
                children: [
                  ...cart.items.map((item) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      children: [
                        Expanded(child: Text(item.name, style: const TextStyle(fontSize: 13, color: AppTheme.textPrimary))),
                        Text('×${item.quantity}', style: const TextStyle(fontSize: 12, color: AppTheme.textMuted)),
                        const SizedBox(width: 12),
                        Text('₹${item.lineTotal.round()}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppTheme.textPrimary)),
                      ],
                    ),
                  )),
                  const Divider(color: AppTheme.cardBorder),
                  _buildSummaryRow('Subtotal', '₹${cart.subtotal.round()}'),
                  if (cart.couponDiscount > 0)
                    _buildSummaryRow('Discount', '-₹${cart.couponDiscount.round()}', highlight: true),
                  _buildSummaryRow(
                    cart.deliveryFee == 0 ? 'Delivery' : 'Delivery',
                    cart.deliveryFee == 0 ? 'FREE' : '₹${cart.deliveryFee.round()}',
                    highlight: cart.deliveryFee == 0,
                  ),
                  const Divider(color: AppTheme.cardBorder),
                  _buildSummaryRow('Total', '₹${cart.total.round()}', bold: true),
                ],
              ),
            ),

            // Error
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: const TextStyle(fontSize: 13, color: AppTheme.errorLight)),
            ],

            const SizedBox(height: 24),

            // Place order
            SizedBox(
              width: double.infinity,
              height: 52,
              child: ElevatedButton(
                onPressed: _isPlacing ? null : _placeOrder,
                child: _isPlacing
                    ? const SizedBox(
                        width: 22, height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                      )
                    : Text('Place Order · ₹${cart.total.round()}'),
              ),
            ),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }

  Widget _buildSection(String title, List<Widget> children) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        border: Border.all(color: AppTheme.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppTheme.textSecondary)),
          const SizedBox(height: 8),
          ...children,
        ],
      ),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 13, color: AppTheme.textMuted)),
          Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppTheme.textPrimary)),
        ],
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Text(
      title,
      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppTheme.textPrimary),
    );
  }

  Widget _buildSummaryRow(String label, String value, {bool bold = false, bool highlight = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
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
