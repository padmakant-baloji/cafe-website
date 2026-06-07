import 'package:flutter/material.dart';
import '../services/api_service.dart';

class Order {
  final int id;
  final String status;
  final List<OrderItem> items;
  final double total;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final String venueName;
  final String venueContactMobile;

  Order({
    required this.id,
    required this.status,
    this.items = const [],
    this.total = 0,
    this.createdAt,
    this.updatedAt,
    this.venueName = '',
    this.venueContactMobile = '',
  });

  factory Order.fromJson(Map<String, dynamic> json) {
    List<OrderItem> items = [];
    final rawItems = json['items'];
    if (rawItems is List) {
      items = rawItems
          .map((i) => i is Map<String, dynamic> ? OrderItem.fromJson(i) : null)
          .whereType<OrderItem>()
          .toList();
    } else if (rawItems is String) {
      try {
        // Items might be stored as JSON string
        final parsed = _tryParseList(rawItems);
        items = parsed
            .map((i) => i is Map<String, dynamic> ? OrderItem.fromJson(i) : null)
            .whereType<OrderItem>()
            .toList();
      } catch (_) {}
    }

    return Order(
      id: (json['id'] is num) ? (json['id'] as num).toInt() : int.tryParse(json['id'].toString()) ?? 0,
      status: (json['status'] ?? '').toString().trim().toLowerCase(),
      items: items,
      total: (json['total'] is num) ? (json['total'] as num).toDouble() : 0,
      createdAt: _parseDate(json['created_at'] ?? json['createdAt']),
      updatedAt: _parseDate(json['updated_at'] ?? json['updatedAt']),
      venueName: (json['venueName'] ?? json['venue_name'] ?? '').toString().trim(),
      venueContactMobile: (json['venueContactMobile'] ?? json['venue_contact_mobile'] ?? '').toString().trim(),
    );
  }

  static DateTime? _parseDate(dynamic v) {
    if (v == null) return null;
    if (v is String) return DateTime.tryParse(v);
    return null;
  }

  static List<dynamic> _tryParseList(String s) {
    try {
      // ignore: avoid_dynamic_calls
      return (s as dynamic) is List ? s as dynamic : [];
    } catch (_) {
      return [];
    }
  }

  bool get isActive => const {'pending', 'accepted', 'preparing', 'out_for_delivery'}.contains(status);
  bool get isCancellable => status == 'pending';
  bool get isCompleted => status == 'completed';
  bool get isCancelled => status == 'cancelled';
  bool get isRejected => status == 'rejected';

  String get statusLabel {
    const map = {
      'pending': 'Waiting for restaurant',
      'accepted': 'Order accepted',
      'rejected': 'Order declined',
      'cancelled': 'You cancelled this order',
      'preparing': 'Preparing your order',
      'out_for_delivery': 'Out for delivery',
      'completed': 'Order completed',
    };
    return map[status] ?? status;
  }

  Color get statusColor {
    switch (status) {
      case 'pending':
        return const Color(0xFFf59e0b);
      case 'accepted':
        return const Color(0xFF3b82f6);
      case 'preparing':
        return const Color(0xFFf97316);
      case 'out_for_delivery':
        return const Color(0xFF22c55e);
      case 'completed':
        return const Color(0xFF10b981);
      case 'rejected':
      case 'cancelled':
        return const Color(0xFFef4444);
      default:
        return const Color(0xFF94a3b8);
    }
  }

  String get friendlyDate {
    if (createdAt == null) return 'Recent order';
    final diff = DateTime.now().difference(createdAt!);
    if (diff.inMinutes < 1) return 'Placed just now';
    if (diff.inMinutes < 60) return 'Placed ${diff.inMinutes} min ago';
    if (diff.inHours < 24) return 'Placed ${diff.inHours}h ago';
    return '${createdAt!.day}/${createdAt!.month}/${createdAt!.year}';
  }
}

class OrderItem {
  final String name;
  final double price;
  final int quantity;

  OrderItem({
    required this.name,
    required this.price,
    this.quantity = 1,
  });

  factory OrderItem.fromJson(Map<String, dynamic> json) {
    return OrderItem(
      name: (json['name'] ?? '').toString(),
      price: (json['price'] is num) ? (json['price'] as num).toDouble() : 0,
      quantity: (json['quantity'] is num) ? (json['quantity'] as num).toInt() : 1,
    );
  }

  double get lineTotal => price * quantity;
}

class OrdersProvider extends ChangeNotifier {
  final ApiService _api = ApiService();

  List<Order> _orders = [];
  bool _isLoading = false;
  String? _error;

  List<Order> get orders => _orders;
  List<Order> get activeOrders => _orders.where((o) => o.isActive).toList();
  List<Order> get pastOrders => _orders.where((o) => !o.isActive).toList();
  bool get isLoading => _isLoading;
  String? get error => _error;

  Future<void> loadOrders() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final data = await _api.getMyOrders();
      if (data['orders'] is List) {
        _orders = (data['orders'] as List)
            .map((o) => o is Map<String, dynamic> ? Order.fromJson(o) : null)
            .whereType<Order>()
            .toList();
      }
      _isLoading = false;
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> cancelOrder(int orderId) async {
    try {
      await _api.cancelOrder(orderId);
      // Update local state
      final idx = _orders.indexWhere((o) => o.id == orderId);
      if (idx >= 0) {
        _orders[idx] = Order(
          id: _orders[idx].id,
          status: 'cancelled',
          items: _orders[idx].items,
          total: _orders[idx].total,
          createdAt: _orders[idx].createdAt,
          updatedAt: DateTime.now(),
          venueName: _orders[idx].venueName,
          venueContactMobile: _orders[idx].venueContactMobile,
        );
        notifyListeners();
      }
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      rethrow;
    }
  }
}
