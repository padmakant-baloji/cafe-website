import 'package:flutter/material.dart';
import '../models/grocery_product.dart';
import '../services/api_service.dart';
import '../services/storage_service.dart';

class GroceryProvider extends ChangeNotifier {
  final ApiService _api = ApiService();
  final StorageService _storage = StorageService();

  List<GroceryStore> _stores = [];
  List<GroceryCategory> _categories = [];
  int? _selectedStoreId;
  double _deliveryFee = 25;
  double _freeDeliveryOver = 199;
  double _minOrder = 49;
  List<GroceryCartItem> _cart = [];
  bool _isLoading = false;
  bool _loaded = false;
  String? _error;
  String _searchQuery = '';

  // Coupon
  String? _couponCode;
  double _couponDiscount = 0;
  String? _couponMessage;
  bool _couponError = false;

  List<GroceryStore> get stores => _stores;
  List<GroceryCategory> get categories => _categoriesForStore;
  int? get selectedStoreId => _selectedStoreId;
  bool get isLoading => _isLoading;
  bool get loaded => _loaded;
  String? get error => _error;
  String get searchQuery => _searchQuery;
  List<GroceryCartItem> get cart => _cart;
  bool get cartIsEmpty => _cart.isEmpty;
  double get deliveryFeeValue => _deliveryFee;
  double get freeDeliveryOver => _freeDeliveryOver;
  double get minOrder => _minOrder;

  String? get couponCode => _couponCode;
  double get couponDiscount => _couponDiscount;
  String? get couponMessage => _couponMessage;
  bool get couponError => _couponError;

  int get cartItemCount => _cart.fold(0, (sum, item) => sum + item.quantity);

  double get cartSubtotal => _cart.fold(0.0, (sum, item) => sum + item.lineTotal);

  double get cartDeliveryFee {
    if (cartSubtotal <= 0) return 0;
    return cartSubtotal >= _freeDeliveryOver ? 0 : _deliveryFee;
  }

  double get cartTotal =>
      (cartSubtotal - _couponDiscount).clamp(0, double.infinity) + cartDeliveryFee;

  GroceryStore? get selectedStore {
    if (_stores.isEmpty) return null;
    return _stores.firstWhere(
      (s) => s.id == _selectedStoreId,
      orElse: () => _stores.first,
    );
  }

  List<GroceryCategory> get _categoriesForStore {
    if (_selectedStoreId == null) return _categories;
    return _categories.where((c) => c.venueId == _selectedStoreId).toList();
  }

  /// Load from storage
  void loadCartFromStorage() {
    try {
      final saved = _storage.groceryCart;
      _cart = saved.map((j) => GroceryCartItem.fromJson(j)).toList();
      notifyListeners();
    } catch (_) {
      _cart = [];
    }
  }

  Future<void> _persistCart() async {
    await _storage.setGroceryCart(_cart.map((i) => i.toJson()).toList());
  }

  /// Load storefront
  Future<void> loadStorefront({bool force = false}) async {
    if (_loaded && !force) return;
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final data = await _api.getGroceryStorefront();
      if (data['stores'] is List) {
        _stores = (data['stores'] as List)
            .map((s) => s is Map<String, dynamic> ? GroceryStore.fromJson(s) : null)
            .whereType<GroceryStore>()
            .toList();
      }
      if (data['categories'] is List) {
        _categories = (data['categories'] as List)
            .map((c) => c is Map<String, dynamic> ? GroceryCategory.fromJson(c) : null)
            .whereType<GroceryCategory>()
            .toList();
      }
      if (data['deliveryFee'] is num) _deliveryFee = (data['deliveryFee'] as num).toDouble();
      if (data['freeDeliveryOver'] is num) _freeDeliveryOver = (data['freeDeliveryOver'] as num).toDouble();
      if (data['minOrder'] is num) _minOrder = (data['minOrder'] as num).toDouble();

      if (_stores.isNotEmpty && _selectedStoreId == null) {
        _selectedStoreId = _stores.first.id;
      }

      // Reconcile cart store
      if (_cart.isNotEmpty) {
        final cartStoreId = _cart.first.venueId;
        if (_stores.any((s) => s.id == cartStoreId)) {
          _selectedStoreId = cartStoreId;
        }
      }

      _loaded = true;
      _isLoading = false;
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      _isLoading = false;
      notifyListeners();
    }
  }

  void selectStore(int storeId) {
    _selectedStoreId = storeId;
    _searchQuery = '';
    notifyListeners();
  }

  void setSearchQuery(String query) {
    _searchQuery = query;
    notifyListeners();
  }

  /// Get products matching search
  List<GroceryProduct> searchProducts(String query) {
    if (query.trim().isEmpty) return [];
    final q = query.trim().toLowerCase();
    final results = <GroceryProduct>[];
    for (final cat in _categoriesForStore) {
      for (final p in cat.products) {
        if (p.name.toLowerCase().contains(q)) {
          results.add(p);
        }
      }
    }
    return results;
  }

  GroceryProduct? findProduct(int productId) {
    for (final cat in _categories) {
      for (final p in cat.products) {
        if (p.id == productId) return p;
      }
    }
    return null;
  }

  int getCartQuantity(int productId) {
    final line = _cart.where((l) => l.productId == productId).firstOrNull;
    return line?.quantity ?? 0;
  }

  // ── Cart mutations ──

  void addToCart(GroceryProduct product) {
    if (product.outOfStock) return;

    // If cart has items from different store, confirm clear
    if (_cart.isNotEmpty && _cart.first.venueId != product.venueId) {
      _cart.clear();
    }

    final existing = _cart.where((l) => l.productId == product.id).firstOrNull;
    if (existing != null) {
      if (existing.quantity >= product.stockQty) return;
      existing.quantity += 1;
    } else {
      _cart.add(GroceryCartItem(
        productId: product.id,
        name: product.name,
        price: product.price,
        mrp: product.mrp,
        unit: product.unit,
        unitValue: product.unitValue,
        image: product.image,
        quantity: 1,
        venueId: product.venueId,
        venueName: product.venueName ?? selectedStore?.name ?? '',
        stockQty: product.stockQty,
      ));
    }

    _invalidateCoupon();
    _persistCart();
    notifyListeners();
  }

  void incrementCartItem(int productId) {
    final line = _cart.where((l) => l.productId == productId).firstOrNull;
    if (line == null) return;
    final product = findProduct(productId);
    final maxStock = product?.stockQty ?? line.stockQty;
    if (line.quantity >= maxStock) return;
    line.quantity += 1;
    _invalidateCoupon();
    _persistCart();
    notifyListeners();
  }

  void decrementCartItem(int productId) {
    final idx = _cart.indexWhere((l) => l.productId == productId);
    if (idx < 0) return;
    _cart[idx].quantity -= 1;
    if (_cart[idx].quantity <= 0) _cart.removeAt(idx);
    _invalidateCoupon();
    _persistCart();
    notifyListeners();
  }

  void clearCart() {
    _cart.clear();
    _couponCode = null;
    _couponDiscount = 0;
    _couponMessage = null;
    _couponError = false;
    _persistCart();
    notifyListeners();
  }

  void _invalidateCoupon() {
    _couponCode = null;
    _couponDiscount = 0;
    _couponMessage = null;
    _couponError = false;
  }

  Future<void> applyCoupon(String code) async {
    if (code.trim().isEmpty) {
      _invalidateCoupon();
      notifyListeners();
      return;
    }
    try {
      final data = await _api.validateCoupon(code, cartSubtotal);
      if (data['ok'] == true) {
        _couponCode = data['code']?.toString() ?? code;
        _couponDiscount = (data['discount'] is num) ? (data['discount'] as num).toDouble() : 0;
        _couponMessage = data['message']?.toString();
        _couponError = false;
      } else {
        _couponCode = null;
        _couponDiscount = 0;
        _couponMessage = data['error']?.toString() ?? 'Invalid coupon.';
        _couponError = true;
      }
    } catch (e) {
      _couponCode = null;
      _couponDiscount = 0;
      _couponMessage = e.toString();
      _couponError = true;
    }
    notifyListeners();
  }
}
