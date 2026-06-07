import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/theme.dart';
import '../../core/routes.dart';
import '../../providers/cart_provider.dart';

class CartScreen extends StatelessWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Your Cart'),
        leading: IconButton(
          icon: const Icon(Icons.close_rounded),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: Consumer<CartProvider>(
        builder: (context, cart, _) {
          if (cart.isEmpty) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.shopping_cart_outlined, size: 64, color: AppTheme.textMuted.withValues(alpha: 0.5)),
                  const SizedBox(height: 16),
                  const Text(
                    'Your cart is empty',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Pick something from the menu!',
                    style: TextStyle(fontSize: 14, color: AppTheme.textSecondary),
                  ),
                  const SizedBox(height: 24),
                  ElevatedButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Browse Menu'),
                  ),
                ],
              ),
            );
          }

          return Column(
            children: [
              Expanded(
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: cart.items.length,
                  separatorBuilder: (_, __) => const Divider(height: 24, color: AppTheme.cardBorder),
                  itemBuilder: (context, index) {
                    final item = cart.items[index];
                    return Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                item.name,
                                style: const TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w600,
                                  color: AppTheme.textPrimary,
                                ),
                              ),
                              if (item.subtitle.isNotEmpty)
                                Padding(
                                  padding: const EdgeInsets.only(top: 2),
                                  child: Text(
                                    item.subtitle,
                                    style: const TextStyle(fontSize: 12, color: AppTheme.textMuted),
                                  ),
                                ),
                              const SizedBox(height: 4),
                              Text(
                                '₹${item.price.round()} each',
                                style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 12),
                        _buildStepper(cart, index, item),
                        const SizedBox(width: 12),
                        SizedBox(
                          width: 60,
                          child: Text(
                            '₹${item.lineTotal.round()}',
                            textAlign: TextAlign.end,
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                              color: AppTheme.textPrimary,
                            ),
                          ),
                        ),
                      ],
                    );
                  },
                ),
              ),

              // Bottom summary
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
                      _buildTotalRow('Subtotal', '₹${cart.subtotal.round()}'),
                      const SizedBox(height: 6),
                      _buildTotalRow(
                        cart.deliveryFee == 0 ? 'Delivery (free)' : 'Delivery',
                        cart.deliveryFee == 0 ? 'FREE' : '₹${cart.deliveryFee.round()}',
                        isHighlight: cart.deliveryFee == 0,
                      ),
                      if (cart.couponDiscount > 0) ...[
                        const SizedBox(height: 6),
                        _buildTotalRow('Discount', '-₹${cart.couponDiscount.round()}', isHighlight: true),
                      ],
                      const Divider(height: 20, color: AppTheme.cardBorder),
                      _buildTotalRow('Total', '₹${cart.total.round()}', isBold: true),
                      const SizedBox(height: 16),
                      SizedBox(
                        width: double.infinity,
                        height: 50,
                        child: ElevatedButton(
                          onPressed: () {
                            Navigator.pushNamed(context, AppRoutes.checkout);
                          },
                          child: Text('Proceed to checkout · ₹${cart.total.round()}'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildStepper(CartProvider cart, int index, CartItem item) {
    return Container(
      height: 32,
      decoration: BoxDecoration(
        color: AppTheme.primary,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          InkWell(
            onTap: () => cart.decrementItem(index),
            child: const SizedBox(
              width: 32, height: 32,
              child: Center(child: Text('−', style: TextStyle(fontSize: 16, color: Colors.white, fontWeight: FontWeight.w600))),
            ),
          ),
          SizedBox(
            width: 28,
            child: Center(
              child: Text('${item.quantity}', style: const TextStyle(fontSize: 14, color: Colors.white, fontWeight: FontWeight.w700)),
            ),
          ),
          InkWell(
            onTap: () => cart.incrementItem(index),
            child: const SizedBox(
              width: 32, height: 32,
              child: Center(child: Text('+', style: TextStyle(fontSize: 16, color: Colors.white, fontWeight: FontWeight.w600))),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTotalRow(String label, String value, {bool isBold = false, bool isHighlight = false}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: isBold ? 16 : 14,
            fontWeight: isBold ? FontWeight.w700 : FontWeight.w500,
            color: isBold ? AppTheme.textPrimary : AppTheme.textSecondary,
          ),
        ),
        Text(
          value,
          style: TextStyle(
            fontSize: isBold ? 16 : 14,
            fontWeight: isBold ? FontWeight.w700 : FontWeight.w600,
            color: isHighlight ? AppTheme.primary : (isBold ? AppTheme.textPrimary : AppTheme.textSecondary),
          ),
        ),
      ],
    );
  }
}
