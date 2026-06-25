class GroceryStore {
  final int id;
  final String name;
  final bool acceptingOrders;

  GroceryStore({
    required this.id,
    required this.name,
    this.acceptingOrders = true,
  });

  factory GroceryStore.fromJson(Map<String, dynamic> json) {
    return GroceryStore(
      id: (json['id'] is num) ? (json['id'] as num).toInt() : int.tryParse(json['id'].toString()) ?? 0,
      name: (json['name'] ?? '').toString(),
      acceptingOrders: json['acceptingOrders'] != false,
    );
  }
}

class GroceryCategory {
  final int id;
  final String name;
  final String? image;
  final int venueId;
  final List<GroceryProduct> products;

  GroceryCategory({
    required this.id,
    required this.name,
    this.image,
    required this.venueId,
    this.products = const [],
  });

  factory GroceryCategory.fromJson(Map<String, dynamic> json) {
    List<GroceryProduct> products = [];
    if (json['products'] is List) {
      products = (json['products'] as List)
          .map((p) => p is Map<String, dynamic> ? GroceryProduct.fromJson(p) : null)
          .whereType<GroceryProduct>()
          .toList();
    }

    return GroceryCategory(
      id: (json['id'] is num) ? (json['id'] as num).toInt() : int.tryParse(json['id'].toString()) ?? 0,
      name: (json['name'] ?? '').toString(),
      image: json['image']?.toString(),
      venueId: (json['venueId'] is num) ? (json['venueId'] as num).toInt() : int.tryParse(json['venueId'].toString()) ?? 0,
      products: products,
    );
  }
}

class GroceryProduct {
  final int id;
  final String name;
  final double price;
  final double mrp;
  final String unit;
  final double unitValue;
  final String? image;
  final int stockQty;
  final bool outOfStock;
  final int venueId;
  final String? venueName;

  GroceryProduct({
    required this.id,
    required this.name,
    required this.price,
    this.mrp = 0,
    this.unit = 'pcs',
    this.unitValue = 1,
    this.image,
    this.stockQty = 0,
    this.outOfStock = false,
    required this.venueId,
    this.venueName,
  });

  factory GroceryProduct.fromJson(Map<String, dynamic> json) {
    return GroceryProduct(
      id: (json['id'] is num) ? (json['id'] as num).toInt() : int.tryParse(json['id'].toString()) ?? 0,
      name: (json['name'] ?? '').toString(),
      price: _parseDouble(json['price']),
      mrp: _parseDouble(json['mrp']),
      unit: (json['unit'] ?? 'pcs').toString(),
      unitValue: _parseDouble(json['unitValue'], fallback: 1),
      image: json['image']?.toString(),
      stockQty: (json['stockQty'] is num) ? (json['stockQty'] as num).toInt() : 0,
      outOfStock: json['outOfStock'] == true,
      venueId: (json['venueId'] is num) ? (json['venueId'] as num).toInt() : int.tryParse(json['venueId'].toString()) ?? 0,
      venueName: json['venueName']?.toString(),
    );
  }

  static double _parseDouble(dynamic v, {double fallback = 0}) {
    if (v is num) return v.toDouble();
    if (v is String) return double.tryParse(v) ?? fallback;
    return fallback;
  }

  bool get hasDiscount => mrp > price && mrp > 0;

  int get discountPercent {
    if (!hasDiscount) return 0;
    return ((mrp - price) / mrp * 100).round();
  }

  String get unitLabel {
    if (unitValue <= 0 || unitValue == 1) {
      return unit == 'pcs' ? '1 pc' : '1 $unit';
    }
    return '${unitValue.toStringAsFixed(unitValue == unitValue.roundToDouble() ? 0 : 1)} $unit';
  }

  String get imageUrl {
    if (image == null || image!.isEmpty) return '';
    if (image!.startsWith('http')) return image!;
    return 'https://www.quickkartcafe.com/$image';
  }
}

class GroceryCartItem {
  final int productId;
  final String name;
  final double price;
  final double mrp;
  final String unit;
  final double unitValue;
  final String? image;
  int quantity;
  final int venueId;
  final String venueName;
  final int stockQty;

  GroceryCartItem({
    required this.productId,
    required this.name,
    required this.price,
    this.mrp = 0,
    this.unit = 'pcs',
    this.unitValue = 1,
    this.image,
    this.quantity = 1,
    required this.venueId,
    this.venueName = '',
    this.stockQty = 0,
  });

  factory GroceryCartItem.fromJson(Map<String, dynamic> json) {
    return GroceryCartItem(
      productId: (json['productId'] as num?)?.toInt() ?? 0,
      name: (json['name'] ?? '').toString(),
      price: GroceryProduct._parseDouble(json['price']),
      mrp: GroceryProduct._parseDouble(json['mrp']),
      unit: (json['unit'] ?? 'pcs').toString(),
      unitValue: GroceryProduct._parseDouble(json['unitValue'], fallback: 1),
      image: json['image']?.toString(),
      quantity: (json['quantity'] as num?)?.toInt() ?? 1,
      venueId: (json['venueId'] as num?)?.toInt() ?? 0,
      venueName: (json['venueName'] ?? '').toString(),
      stockQty: (json['stockQty'] as num?)?.toInt() ?? 0,
    );
  }

  Map<String, dynamic> toJson() => {
    'productId': productId,
    'name': name,
    'price': price,
    'mrp': mrp,
    'unit': unit,
    'unitValue': unitValue,
    'image': image,
    'quantity': quantity,
    'venueId': venueId,
    'venueName': venueName,
    'stockQty': stockQty,
  };

  double get lineTotal => price * quantity;

  String get unitLabel {
    if (unitValue <= 0 || unitValue == 1) {
      return unit == 'pcs' ? '1 pc' : '1 $unit';
    }
    return '${unitValue.toStringAsFixed(unitValue == unitValue.roundToDouble() ? 0 : 1)} $unit';
  }
}
