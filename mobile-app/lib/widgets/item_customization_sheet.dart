import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../core/theme.dart';
import '../models/menu_item.dart';

class ItemCustomizationSheet extends StatefulWidget {
  final MenuItem item;
  final void Function(MenuSize? size, List<MenuAddon> addons) onAddToCart;

  const ItemCustomizationSheet({
    super.key,
    required this.item,
    required this.onAddToCart,
  });

  @override
  State<ItemCustomizationSheet> createState() => _ItemCustomizationSheetState();
}

class _ItemCustomizationSheetState extends State<ItemCustomizationSheet> {
  MenuSize? _selectedSize;
  final Set<int> _selectedAddonIndices = {};

  @override
  void initState() {
    super.initState();
    if (widget.item.hasSizes) {
      _selectedSize = widget.item.sizes.first;
    }
  }

  double get _totalPrice {
    double price = _selectedSize?.price ?? widget.item.price ?? 0;
    for (final idx in _selectedAddonIndices) {
      if (idx < widget.item.addons.length) {
        price += widget.item.addons[idx].price;
      }
    }
    return price;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.radiusXl)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Drag handle
          Center(
            child: Container(
              margin: const EdgeInsets.only(top: 12),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppTheme.surfaceLight,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),

          // Header with image
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Image
                ClipRRect(
                  borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                  child: SizedBox(
                    width: 80,
                    height: 80,
                    child: widget.item.imageUrl.isNotEmpty
                        ? CachedNetworkImage(
                            imageUrl: widget.item.imageUrl,
                            fit: BoxFit.cover,
                            placeholder: (_, __) => Container(color: AppTheme.surfaceLight),
                            errorWidget: (_, __, ___) => Container(
                              color: AppTheme.surfaceLight,
                              child: const Icon(Icons.restaurant, color: AppTheme.textMuted),
                            ),
                          )
                        : Container(
                            color: AppTheme.surfaceLight,
                            child: const Icon(Icons.restaurant, color: AppTheme.textMuted),
                          ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.item.name,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: AppTheme.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '₹${_totalPrice.round()}',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: AppTheme.primaryLight,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          const Divider(height: 1, color: AppTheme.cardBorder),

          // Size selection
          if (widget.item.hasSizes) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Row(
                children: [
                  const Text(
                    'SIZE',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: AppTheme.textSecondary,
                      letterSpacing: 1,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppTheme.error.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: const Text(
                      'Required',
                      style: TextStyle(fontSize: 10, color: AppTheme.errorLight, fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ),
            ...widget.item.sizes.map((size) => RadioListTile<MenuSize>(
                  value: size,
                  groupValue: _selectedSize,
                  onChanged: (val) => setState(() => _selectedSize = val),
                  title: Text(
                    size.label,
                    style: const TextStyle(fontSize: 14, color: AppTheme.textPrimary),
                  ),
                  secondary: Text(
                    '₹${size.price.round()}',
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
                  ),
                  activeColor: AppTheme.primary,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12),
                  dense: true,
                )),
            const SizedBox(height: 8),
          ],

          // Addon selection
          if (widget.item.hasAddons) ...[
            if (widget.item.hasSizes)
              const Divider(height: 1, color: AppTheme.cardBorder),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Row(
                children: [
                  const Text(
                    'ADD-ONS',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: AppTheme.textSecondary,
                      letterSpacing: 1,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppTheme.surfaceLight,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: const Text(
                      'Optional',
                      style: TextStyle(fontSize: 10, color: AppTheme.textMuted, fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ),
            ...widget.item.addons.asMap().entries.map((entry) {
              final idx = entry.key;
              final addon = entry.value;
              return CheckboxListTile(
                value: _selectedAddonIndices.contains(idx),
                onChanged: (val) {
                  setState(() {
                    if (val == true) {
                      _selectedAddonIndices.add(idx);
                    } else {
                      _selectedAddonIndices.remove(idx);
                    }
                  });
                },
                title: Text(
                  addon.label,
                  style: const TextStyle(fontSize: 14, color: AppTheme.textPrimary),
                ),
                secondary: Text(
                  '+₹${addon.price.round()}',
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
                ),
                activeColor: AppTheme.primary,
                checkColor: Colors.white,
                contentPadding: const EdgeInsets.symmetric(horizontal: 12),
                dense: true,
              );
            }),
            const SizedBox(height: 8),
          ],

          // Add to cart button
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: SafeArea(
              top: false,
              child: SizedBox(
                width: double.infinity,
                height: 50,
                child: ElevatedButton(
                  onPressed: () {
                    final selectedAddons = _selectedAddonIndices
                        .where((i) => i < widget.item.addons.length)
                        .map((i) => widget.item.addons[i])
                        .toList();
                    widget.onAddToCart(_selectedSize, selectedAddons);
                    Navigator.pop(context);
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primary,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                    ),
                  ),
                  child: Text(
                    'Add to cart · ₹${_totalPrice.round()}',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
