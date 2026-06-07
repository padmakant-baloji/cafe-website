import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../../core/theme.dart';
import '../../providers/grocery_provider.dart';
import '../../models/grocery_product.dart';
import '../../widgets/loading_shimmer.dart';

class GroceryScreen extends StatefulWidget {
  const GroceryScreen({super.key});

  @override
  State<GroceryScreen> createState() => _GroceryScreenState();
}

class _GroceryScreenState extends State<GroceryScreen> {
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<GroceryProvider>().loadStorefront();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<GroceryProvider>(
      builder: (context, grocery, _) {
        if (grocery.isLoading && !grocery.loaded) {
          return const Padding(
            padding: EdgeInsets.only(top: 60),
            child: LoadingShimmer(itemCount: 6),
          );
        }

        if (grocery.stores.isEmpty) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.store_outlined, size: 48, color: AppTheme.textMuted),
                const SizedBox(height: 12),
                const Text('No grocery stores available yet', style: TextStyle(color: AppTheme.textSecondary)),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: () => grocery.loadStorefront(force: true),
                  child: const Text('Retry'),
                ),
              ],
            ),
          );
        }

        return RefreshIndicator(
          onRefresh: () => grocery.loadStorefront(force: true),
          color: AppTheme.primary,
          child: CustomScrollView(
            slivers: [
              // Search bar
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                  child: TextField(
                    controller: _searchController,
                    onChanged: (val) => grocery.setSearchQuery(val),
                    style: const TextStyle(color: AppTheme.textPrimary),
                    decoration: InputDecoration(
                      hintText: 'Search grocery items...',
                      prefixIcon: const Icon(Icons.search, color: AppTheme.textMuted),
                      suffixIcon: _searchController.text.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.close, color: AppTheme.textMuted),
                              onPressed: () {
                                _searchController.clear();
                                grocery.setSearchQuery('');
                              },
                            )
                          : null,
                    ),
                  ),
                ),
              ),

              // Store tabs
              if (grocery.stores.length > 1)
                SliverToBoxAdapter(
                  child: SizedBox(
                    height: 42,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      itemCount: grocery.stores.length,
                      separatorBuilder: (_, __) => const SizedBox(width: 8),
                      itemBuilder: (_, index) {
                        final store = grocery.stores[index];
                        final isActive = store.id == grocery.selectedStoreId;
                        return ChoiceChip(
                          label: Text(store.name),
                          selected: isActive,
                          onSelected: (_) => grocery.selectStore(store.id),
                          selectedColor: AppTheme.primary,
                          backgroundColor: AppTheme.surface,
                          labelStyle: TextStyle(
                            color: isActive ? Colors.white : AppTheme.textSecondary,
                            fontWeight: isActive ? FontWeight.w600 : FontWeight.w500,
                          ),
                        );
                      },
                    ),
                  ),
                ),

              // Category sections with products
              ...grocery.categories.map((cat) {
                final products = grocery.searchQuery.isNotEmpty
                    ? cat.products.where((p) => p.name.toLowerCase().contains(grocery.searchQuery.toLowerCase())).toList()
                    : cat.products;

                if (products.isEmpty) return const SliverToBoxAdapter(child: SizedBox.shrink());

                return SliverToBoxAdapter(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 20, 16, 10),
                        child: Text(
                          cat.name,
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                            color: AppTheme.textPrimary,
                          ),
                        ),
                      ),
                      GridView.builder(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 2,
                          childAspectRatio: 0.65,
                          crossAxisSpacing: 10,
                          mainAxisSpacing: 10,
                        ),
                        itemCount: products.length,
                        itemBuilder: (_, index) => _GroceryProductCard(product: products[index]),
                      ),
                    ],
                  ),
                );
              }),

              const SliverToBoxAdapter(child: SizedBox(height: 120)),
            ],
          ),
        );
      },
    );
  }
}

class _GroceryProductCard extends StatelessWidget {
  final GroceryProduct product;
  const _GroceryProductCard({required this.product});

  @override
  Widget build(BuildContext context) {
    return Consumer<GroceryProvider>(
      builder: (context, grocery, _) {
        final qty = grocery.getCartQuantity(product.id);

        return Container(
          decoration: BoxDecoration(
            color: AppTheme.surface,
            borderRadius: BorderRadius.circular(AppTheme.radiusLg),
            border: Border.all(color: AppTheme.cardBorder, width: 0.5),
          ),
          child: Stack(
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Image
                  ClipRRect(
                    borderRadius: const BorderRadius.vertical(top: Radius.circular(AppTheme.radiusLg)),
                    child: AspectRatio(
                      aspectRatio: 1.3,
                      child: product.imageUrl.isNotEmpty
                          ? CachedNetworkImage(
                              imageUrl: product.imageUrl,
                              fit: BoxFit.cover,
                              placeholder: (_, __) => Container(color: AppTheme.surfaceLight),
                              errorWidget: (_, __, ___) => Container(
                                color: AppTheme.surfaceLight,
                                child: const Icon(Icons.shopping_basket, color: AppTheme.textMuted),
                              ),
                            )
                          : Container(
                              color: AppTheme.surfaceLight,
                              child: const Icon(Icons.shopping_basket, color: AppTheme.textMuted, size: 32),
                            ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          product.unitLabel,
                          style: const TextStyle(fontSize: 11, color: AppTheme.textMuted),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          product.name,
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: AppTheme.textPrimary,
                            height: 1.2,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            Text(
                              '₹${product.price.round()}',
                              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppTheme.primaryLight),
                            ),
                            if (product.hasDiscount) ...[
                              const SizedBox(width: 4),
                              Text(
                                '₹${product.mrp.round()}',
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: AppTheme.textMuted,
                                  decoration: TextDecoration.lineThrough,
                                ),
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: 8),
                        // Action
                        if (product.outOfStock)
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.symmetric(vertical: 6),
                            decoration: BoxDecoration(
                              color: AppTheme.error.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: const Center(
                              child: Text('Out of stock', style: TextStyle(fontSize: 12, color: AppTheme.error, fontWeight: FontWeight.w600)),
                            ),
                          )
                        else if (qty > 0)
                          _buildStepper(context, grocery, qty)
                        else
                          SizedBox(
                            width: double.infinity,
                            height: 34,
                            child: ElevatedButton(
                              onPressed: () => grocery.addToCart(product),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: AppTheme.primary.withValues(alpha: 0.15),
                                foregroundColor: AppTheme.primary,
                                elevation: 0,
                                padding: EdgeInsets.zero,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(8),
                                  side: const BorderSide(color: AppTheme.primary),
                                ),
                              ),
                              child: const Text('ADD', style: TextStyle(fontWeight: FontWeight.w700, letterSpacing: 0.5)),
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
              // Discount badge
              if (product.hasDiscount)
                Positioned(
                  top: 8,
                  left: 8,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppTheme.primary,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      '${product.discountPercent}% OFF',
                      style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: Colors.white),
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildStepper(BuildContext context, GroceryProvider grocery, int qty) {
    return Container(
      height: 34,
      decoration: BoxDecoration(
        color: AppTheme.primary,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          InkWell(
            onTap: () => grocery.decrementCartItem(product.id),
            child: const SizedBox(width: 36, height: 34, child: Center(child: Text('−', style: TextStyle(fontSize: 16, color: Colors.white, fontWeight: FontWeight.w600)))),
          ),
          Text('$qty', style: const TextStyle(fontSize: 14, color: Colors.white, fontWeight: FontWeight.w700)),
          InkWell(
            onTap: () => grocery.incrementCartItem(product.id),
            child: const SizedBox(width: 36, height: 34, child: Center(child: Text('+', style: TextStyle(fontSize: 16, color: Colors.white, fontWeight: FontWeight.w600)))),
          ),
        ],
      ),
    );
  }
}
