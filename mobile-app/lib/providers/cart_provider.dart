import 'package:flutter/material.dart';
import '../models/menu_item.dart';
import '../services/api_service.dart';
import '../services/storage_service.dart';
import '../core/constants.dart';

class CartItem {
  final String itemId;
  final String name;
  final String image;
  final double price;
  final int? venueId;
  final String venueName;
  final String? sizeLabel;
  final List<String> addonLabels;
  int quantity;

  CartItem({
    required this.itemId,
    required this.name,
    this.image = '',
    required this.price,
    this.venueId,
    this.venueName = '',
    this.sizeLabel,
    this.addonLabels = const [],
    this.quantity = 1,
  });

  double get lineTotal => price * quantity;

  /// Unique key combining item ID + size + addons for cart deduplication
  String get cartKey {
    final parts = [itemId];
    if (sizeLabel != null) parts.add('size:$sizeLabel');
    if (addonLabels.isNotEmpty) parts.add('addons:${addonLabels.join(',')}');
    return parts.join('|');
  }

  String get subtitle {
    final parts = <String>[];
    if (sizeLabel != null) parts.add(sizeLabel!);
    parts.addAll(addonLabels);
    return parts.join(' · ');
  }

  Map<String, dynamic> toJson() => {
    'itemId': itemId,
    'name': name,
    'image': image,
    'price': price,
    'venueId': venueId,
    'venueName': venueName,
    'sizeLabel': sizeLabel,
    'addonLabels': addonLabels,
    'quantity': quantity,
  };

  factory CartItem.fromJson(Map<String, dynamic> json) {
    return CartItem(
      itemId: (json['itemId'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      image: (json['image'] ?? '').toString(),
      price: (json['price'] is num) ? (json['price'] as num).toDouble() : 0,
      venueId: json['venueId'] != null ? int.tryParse(json['venueId'].toString()) : null,
      venueName: (json['venueName'] ?? '').toString(),
      sizeLabel: json['sizeLabel']?.toString(),
      addonLabels: (json['addonLabels'] is List)
          ? (json['addonLabels'] as List).map((e) => e.toString()).toList()
          : [],
      quantity: (json['quantity'] is num) ? (json['quantity'] as num).toInt() : 1,
    );
  }
}

class CartProvider extends ChangeNotifier {
  final StorageService _storage = StorageService();
  final ApiService _api = ApiService();

  List<CartItem> _items = [];
  String? _couponCode;
  double _couponDiscount = 0;
  String? _couponMessage;
  bool _couponError = false;

  List<CartItem> get items => _items;
  int get itemCount => _items.fold(0, (sum, item) => sum + item.quantity);
  bool get isEmpty => _items.isEmpty;
  bool get isNotEmpty => _items.isNotEmpty;

  String? get couponCode => _couponCode;
  double get couponDiscount => _couponDiscount;
  String? get couponMessage => _couponMessage;
  bool get couponError => _couponError;

  double get subtotal => _items.fold(0.0, (sum, item) => sum + item.lineTotal);

  double get deliveryFee {
    if (subtotal <= 0) return 0;

    final profile = _storage.profile;
    final city = profile?['city']?.toString().toLowerCase().trim() ?? '';
    final isKudachi = city == 'kudachi';

    final isBaloji = _items.isNotEmpty && _items.first.venueName.toLowerCase().contains('baloji');

    if (isBaloji || _items.isEmpty) {
      return 8.0;
    } else {
      return isKudachi ? 20.0 : 40.0;
    }
  }

  double get total => (subtotal - _couponDiscount).clamp(0, double.infinity) + deliveryFee;

  /// Load cart from storage
  void loadFromStorage() {
    try {
      final saved = _storage.foodCart;
      _items = saved.map((j) => CartItem.fromJson(j)).toList();
      notifyListeners();
    } catch (_) {
      _items = [];
    }
  }

  Future<void> _persist() async {
    await _storage.setFoodCart(_items.map((i) => i.toJson()).toList());
  }

  /// Add item to cart with optional size and addons
  bool addItem(MenuItem menuItem, {MenuSize? size, List<MenuAddon>? addons}) {
    if (_items.isNotEmpty && _items.first.venueId != menuItem.venueId) {
      return false; // Venue mismatch, handled by UI
    }

    final selectedAddons = addons ?? [];
    double price = size?.price ?? menuItem.price ?? 0;
    for (final addon in selectedAddons) {
      price += addon.price;
    }

    final cartItem = CartItem(
      itemId: menuItem.id,
      name: menuItem.name,
      image: menuItem.image,
      price: price,
      venueId: menuItem.venueId,
      venueName: menuItem.venueName,
      sizeLabel: size?.label,
      addonLabels: selectedAddons.map((a) => a.label).toList(),
    );

    // Check if same variant exists
    final existingIdx = _items.indexWhere((i) => i.cartKey == cartItem.cartKey);
    if (existingIdx >= 0) {
      _items[existingIdx].quantity += 1;
    } else {
      _items.add(cartItem);
    }

    _invalidateCoupon();
    _persist();
    notifyListeners();
    return true;
  }

  /// Increment quantity
  void incrementItem(int index) {
    if (index < 0 || index >= _items.length) return;
    _items[index].quantity += 1;
    _invalidateCoupon();
    _persist();
    notifyListeners();
  }

  /// Decrement quantity (remove if 0)
  void decrementItem(int index) {
    if (index < 0 || index >= _items.length) return;
    _items[index].quantity -= 1;
    if (_items[index].quantity <= 0) {
      _items.removeAt(index);
    }
    _invalidateCoupon();
    _persist();
    notifyListeners();
  }

  /// Remove item entirely
  void removeItem(int index) {
    if (index < 0 || index >= _items.length) return;
    _items.removeAt(index);
    _invalidateCoupon();
    _persist();
    notifyListeners();
  }

  /// Clear cart
  void clear() {
    _items.clear();
    _couponCode = null;
    _couponDiscount = 0;
    _couponMessage = null;
    _couponError = false;
    _persist();
    notifyListeners();
  }

  void _invalidateCoupon() {
    // Clear coupon when cart changes
    _couponCode = null;
    _couponDiscount = 0;
    _couponMessage = null;
    _couponError = false;
  }

  /// Validate coupon
  Future<void> applyCoupon(String code) async {
    if (code.trim().isEmpty) {
      _couponCode = null;
      _couponDiscount = 0;
      _couponMessage = null;
      _couponError = false;
      notifyListeners();
      return;
    }

    try {
      final data = await _api.validateCoupon(code, subtotal);
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

  /// Build order payload for API
  Map<String, dynamic> buildOrderPayload({
    required String addressLine,
    required String city,
    String? addressId,
    String? note,
  }) {
    final payload = <String, dynamic>{
      'items': _items.map((item) => {
        'id': item.itemId,
        'name': item.name,
        'price': item.price,
        'quantity': item.quantity,
        'venueId': item.venueId,
        'size': item.sizeLabel ?? '',
        'addons': item.addonLabels,
      }).toList(),
      'total': total.round(),
      'orderVenueId': _items.isNotEmpty ? _items.first.venueId : null,
      'addressLine': addressLine,
      'city': city,
    };
    if (addressId != null) payload['addressId'] = addressId;
    if (_couponCode != null) payload['couponCode'] = _couponCode;
    if (note != null && note.isNotEmpty) payload['note'] = note;
    return payload;
  }
}
