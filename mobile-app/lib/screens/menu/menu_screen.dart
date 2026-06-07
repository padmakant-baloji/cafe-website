import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/theme.dart';
import '../../providers/menu_provider.dart';
import '../../providers/cart_provider.dart';
import '../../models/menu_item.dart';
import '../../widgets/menu_item_card.dart';
import '../../widgets/item_customization_sheet.dart';
import '../../widgets/loading_shimmer.dart';

class MenuScreen extends StatefulWidget {
  const MenuScreen({super.key});

  @override
  State<MenuScreen> createState() => _MenuScreenState();
}

class _MenuScreenState extends State<MenuScreen> {
  final ScrollController _scrollController = ScrollController();
  final Map<String, GlobalKey> _categoryKeys = {};
  final TextEditingController _searchController = TextEditingController();
  int _activeCategoryIndex = 0;
  bool _programmaticScroll = false;
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<MenuProvider>().loadMenu();
    });
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_programmaticScroll) return;
    final categories = context.read<MenuProvider>().activeCategories;
    if (categories.isEmpty) return;

    int newIndex = 0;
    for (int i = 0; i < categories.length; i++) {
      final key = _categoryKeys[categories[i].id];
      if (key?.currentContext != null) {
        final box = key!.currentContext!.findRenderObject() as RenderBox;
        final pos = box.localToGlobal(Offset.zero);
        if (pos.dy <= 160) {
          newIndex = i;
        }
      }
    }

    if (newIndex != _activeCategoryIndex) {
      setState(() => _activeCategoryIndex = newIndex);
    }
  }

  void _scrollToCategory(int index) async {
    final categories = context.read<MenuProvider>().activeCategories;
    if (index < 0 || index >= categories.length) return;

    setState(() {
      _activeCategoryIndex = index;
      _programmaticScroll = true;
    });

    final key = _categoryKeys[categories[index].id];
    if (key?.currentContext != null) {
      await Scrollable.ensureVisible(
        key!.currentContext!,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOutCubic,
        alignment: 0,
      );
    }

    await Future.delayed(const Duration(milliseconds: 400));
    _programmaticScroll = false;
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<MenuProvider>(
      builder: (context, menu, _) {
        if (menu.isLoading && !menu.loaded) {
          return const Padding(
            padding: EdgeInsets.only(top: 100),
            child: LoadingShimmer(itemCount: 6),
          );
        }

        if (menu.activeCategories.isEmpty) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.restaurant_menu, size: 48, color: AppTheme.textMuted),
                const SizedBox(height: 12),
                const Text('No menu items available', style: TextStyle(color: AppTheme.textSecondary)),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: () => menu.loadMenu(force: true),
                  child: const Text('Retry'),
                ),
              ],
            ),
          );
        }

        // Ensure keys exist
        for (final cat in menu.activeCategories) {
          _categoryKeys.putIfAbsent(cat.id, () => GlobalKey());
        }

        return Column(
          children: [
            // Search Bar
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: TextField(
                controller: _searchController,
                onChanged: (val) => setState(() => _searchQuery = val),
                style: const TextStyle(color: AppTheme.textPrimary, fontSize: 15),
                decoration: InputDecoration(
                  hintText: 'Search for biryani, pizza, etc...',
                  prefixIcon: const Icon(Icons.search, color: AppTheme.textMuted),
                  suffixIcon: _searchQuery.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.close, color: AppTheme.textMuted),
                          onPressed: () {
                            _searchController.clear();
                            setState(() => _searchQuery = '');
                          },
                        )
                      : null,
                  filled: true,
                  fillColor: AppTheme.surfaceLight.withValues(alpha: 0.3),
                  contentPadding: const EdgeInsets.symmetric(vertical: 0, horizontal: 16),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppTheme.radiusFull),
                    borderSide: BorderSide(color: AppTheme.cardBorder, width: 1),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppTheme.radiusFull),
                    borderSide: BorderSide(color: AppTheme.cardBorder, width: 1),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppTheme.radiusFull),
                    borderSide: const BorderSide(color: AppTheme.primary, width: 1),
                  ),
                ),
              ),
            ),

            if (_searchQuery.isNotEmpty)
              Expanded(child: _buildSearchResults(menu))
            else ...[
              // Venue tabs if multiple venues exist
              if (menu.venues.length > 1)
                _buildVenueTabs(menu.venues, menu.selectedVenueId, menu.selectVenue),
              
              // Category tabs
              _buildCategoryTabs(menu.activeCategories),
              
              // Menu items
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () => menu.loadMenu(force: true),
                  color: AppTheme.primary,
                  child: ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 120),
                    itemCount: menu.activeCategories.length,
                    itemBuilder: (context, index) => _buildCategorySection(menu.activeCategories[index]),
                  ),
                ),
              ),
            ],
          ],
        );
      },
    );
  }

  Widget _buildSearchResults(MenuProvider menu) {
    final results = menu.search(_searchQuery);

    if (results.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.search_off_rounded, size: 64, color: AppTheme.textMuted.withValues(alpha: 0.5)),
            const SizedBox(height: 16),
            const Text(
              'No items found',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
            ),
            const SizedBox(height: 8),
            Text(
              'Try searching for something else',
              style: TextStyle(fontSize: 14, color: AppTheme.textSecondary),
            ),
          ],
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 120),
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 16),
          child: Text(
            'Search Results (${results.length})',
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppTheme.textPrimary),
          ),
        ),
        _buildItemsGrid(results),
      ],
    );
  }

  Widget _buildVenueTabs(List<MenuVenue> venues, int? selectedVenueId, Function(int) onSelect) {
    return Container(
      height: 48,
      decoration: const BoxDecoration(
        color: AppTheme.surface,
      ),
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        itemCount: venues.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final venue = venues[index];
          final isActive = venue.id == selectedVenueId;
          return ChoiceChip(
            label: Text(venue.name),
            selected: isActive,
            onSelected: (_) {
              onSelect(venue.id);
              // Reset category scroll position
              _scrollController.jumpTo(0);
              setState(() => _activeCategoryIndex = 0);
            },
            selectedColor: AppTheme.primary,
            backgroundColor: AppTheme.surfaceLight,
            labelStyle: TextStyle(
              color: isActive ? Colors.white : AppTheme.textSecondary,
              fontWeight: isActive ? FontWeight.w600 : FontWeight.w500,
              fontSize: 13,
            ),
            padding: const EdgeInsets.symmetric(horizontal: 4),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            side: BorderSide.none,
          );
        },
      ),
    );
  }

  Widget _buildCategoryTabs(List<MenuCategory> categories) {
    return Container(
      height: 46,
      decoration: const BoxDecoration(
        color: AppTheme.surface,
        border: Border(bottom: BorderSide(color: AppTheme.cardBorder, width: 0.5)),
      ),
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        itemCount: categories.length,
        separatorBuilder: (_, __) => const SizedBox(width: 6),
        itemBuilder: (context, index) {
          final cat = categories[index];
          final isActive = index == _activeCategoryIndex;
          return GestureDetector(
            onTap: () => _scrollToCategory(index),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
              decoration: BoxDecoration(
                color: isActive ? AppTheme.primary : AppTheme.surfaceLight.withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(AppTheme.radiusFull),
                border: Border.all(
                  color: isActive ? AppTheme.primary : AppTheme.surfaceLight,
                  width: 1,
                ),
              ),
              child: Text(
                cat.name,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: isActive ? FontWeight.w700 : FontWeight.w500,
                  color: isActive ? Colors.white : AppTheme.textSecondary,
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildCategorySection(MenuCategory category) {
    return Column(
      key: _categoryKeys[category.id],
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 20),
        Text(
          category.name,
          style: const TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w700,
            color: AppTheme.textPrimary,
          ),
        ),
        const SizedBox(height: 12),

        if (category.hasSubsections)
          ...category.subsections.map((sub) => _buildSubsection(sub))
        else
          _buildItemsGrid(category.items),
      ],
    );
  }

  Widget _buildSubsection(MenuSubsection subsection) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 8, bottom: 4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                subsection.title,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.textPrimary,
                ),
              ),
              if (subsection.subtitle.isNotEmpty)
                Text(
                  subsection.subtitle,
                  style: const TextStyle(fontSize: 12, color: AppTheme.textMuted),
                ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        _buildItemsGrid(subsection.items),
      ],
    );
  }

  Widget _buildItemsGrid(List<MenuItem> items) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        childAspectRatio: 0.72,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
      ),
      itemCount: items.length,
      itemBuilder: (context, index) {
        final item = items[index];
        return Consumer<CartProvider>(
          builder: (context, cart, _) {
            final qty = cart.items
                .where((c) => c.itemId == item.id && !item.needsCustomization)
                .fold(0, (sum, c) => sum + c.quantity);

            return MenuItemCard(
              item: item,
              quantity: qty,
              onAdd: () => _onAddItem(item),
              onIncrement: () {
                final idx = cart.items.indexWhere((c) => c.itemId == item.id);
                if (idx >= 0) cart.incrementItem(idx);
              },
              onDecrement: () {
                final idx = cart.items.indexWhere((c) => c.itemId == item.id);
                if (idx >= 0) cart.decrementItem(idx);
              },
            );
          },
        );
      },
    );
  }

  void _onAddItem(MenuItem item) {
    if (item.needsCustomization) {
      showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (_) => ItemCustomizationSheet(
          item: item,
          onAddToCart: (size, addons) {
            final added = context.read<CartProvider>().addItem(item, size: size, addons: addons);
            if (!added) {
              _showClearCartDialog(item, size: size, addons: addons);
            } else {
              _showSuccessSnackbar(item.name);
            }
          },
        ),
      );
    } else {
      final added = context.read<CartProvider>().addItem(item);
      if (!added) {
        _showClearCartDialog(item);
      } else {
        _showSuccessSnackbar(item.name);
      }
    }
  }

  void _showSuccessSnackbar(String name) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('$name added to cart'),
        duration: const Duration(seconds: 1),
        backgroundColor: AppTheme.primary,
      ),
    );
  }

  void _showClearCartDialog(MenuItem item, {MenuSize? size, List<MenuAddon>? addons}) {
    final cart = context.read<CartProvider>();
    final currentVenue = cart.items.isNotEmpty && cart.items.first.venueName.isNotEmpty 
        ? cart.items.first.venueName 
        : 'another hotel';
    final newVenue = item.venueName.isNotEmpty ? item.venueName : 'this hotel';
    
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Clear cart?'),
        content: Text('Your cart contains items from $currentVenue. Do you want to discard the selection and add items from $newVenue?'),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel', style: TextStyle(color: AppTheme.textSecondary)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.primary,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            onPressed: () {
              Navigator.pop(ctx);
              cart.clear();
              cart.addItem(item, size: size, addons: addons);
              _showSuccessSnackbar(item.name);
            },
            child: const Text('Clear & Add'),
          ),
        ],
      ),
    );
  }
}
