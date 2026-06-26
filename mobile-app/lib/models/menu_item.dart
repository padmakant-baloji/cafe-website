class MenuCategory {
  final String id;
  final String name;
  final int? venueId;
  final String venueName;
  final List<MenuItem> items;
  final List<MenuSubsection> subsections;

  MenuCategory({
    required this.id,
    required this.name,
    this.venueId,
    this.venueName = '',
    this.items = const [],
    this.subsections = const [],
  });

  factory MenuCategory.fromJson(Map<String, dynamic> json) {
    List<MenuItem> items = [];
    if (json['items'] is List) {
      items = (json['items'] as List)
          .map((i) => i is Map<String, dynamic> ? MenuItem.fromJson(i) : null)
          .whereType<MenuItem>()
          .toList();
    }

    List<MenuSubsection> subsections = [];
    if (json['subsections'] is List) {
      subsections = (json['subsections'] as List)
          .map((s) => s is Map<String, dynamic> ? MenuSubsection.fromJson(s) : null)
          .whereType<MenuSubsection>()
          .toList();
    }

    return MenuCategory(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      venueId: json['venueId'] != null ? int.tryParse(json['venueId'].toString()) : null,
      venueName: (json['venueName'] ?? '').toString(),
      items: items,
      subsections: subsections,
    );
  }

  /// Get all items including those inside subsections
  List<MenuItem> get allItems {
    final all = <MenuItem>[...items];
    for (final sub in subsections) {
      all.addAll(sub.items);
    }
    return all;
  }

  bool get hasSubsections => subsections.isNotEmpty;
}

class MenuSubsection {
  final String id;
  final String title;
  final String subtitle;
  final List<MenuItem> items;

  MenuSubsection({
    required this.id,
    required this.title,
    this.subtitle = '',
    this.items = const [],
  });

  factory MenuSubsection.fromJson(Map<String, dynamic> json) {
    List<MenuItem> items = [];
    if (json['items'] is List) {
      items = (json['items'] as List)
          .map((i) => i is Map<String, dynamic> ? MenuItem.fromJson(i) : null)
          .whereType<MenuItem>()
          .toList();
    }

    return MenuSubsection(
      id: (json['id'] ?? '').toString(),
      title: (json['title'] ?? '').toString(),
      subtitle: (json['subtitle'] ?? '').toString(),
      items: items,
    );
  }
}

class MenuItem {
  final String id;
  final String name;
  final String image;
  final String alt;
  final double? price; // null if sizes are used
  final int? venueId;
  final String venueName;
  final List<MenuSize> sizes;
  final List<MenuAddon> addons;

  MenuItem({
    required this.id,
    required this.name,
    this.image = '',
    this.alt = '',
    this.price,
    this.venueId,
    this.venueName = '',
    this.sizes = const [],
    this.addons = const [],
  });

  factory MenuItem.fromJson(Map<String, dynamic> json) {
    final venueName = (json['venueName'] ?? '').toString();
    final isBaloji Cafe = venueName.toLowerCase().contains('quickkart') || (json['venueId'] == null);

    List<MenuSize> sizes = [];
    if (json['sizes'] is List) {
      sizes = (json['sizes'] as List)
          .map((s) {
            if (s is Map<String, dynamic>) {
              final size = MenuSize.fromJson(s);
              return isBaloji Cafe 
                  ? MenuSize(label: size.label, price: (size.price * 0.8).roundToDouble())
                  : size;
            }
            return null;
          })
          .whereType<MenuSize>()
          .toList();
    }

    List<MenuAddon> addons = [];
    if (json['addons'] is List) {
      addons = (json['addons'] as List)
          .map((a) => a is Map<String, dynamic> ? MenuAddon.fromJson(a) : null)
          .whereType<MenuAddon>()
          .toList();
    }

    double? price;
    if (json['price'] != null) {
      price = (json['price'] is num) ? (json['price'] as num).toDouble() : double.tryParse(json['price'].toString());
      if (price != null && isBaloji Cafe) {
        price = (price * 0.8).roundToDouble();
      }
    }

    return MenuItem(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      image: (json['image'] ?? '').toString(),
      alt: (json['alt'] ?? '').toString(),
      price: price,
      venueId: json['venueId'] != null ? int.tryParse(json['venueId'].toString()) : null,
      venueName: venueName,
      sizes: sizes,
      addons: addons,
    );
  }

  bool get hasSizes => sizes.isNotEmpty;
  bool get hasAddons => addons.isNotEmpty;
  bool get needsCustomization => hasSizes || hasAddons;

  /// Display price: fixed price or lowest size price
  double get displayPrice {
    if (price != null) return price!;
    if (sizes.isNotEmpty) return sizes.first.price;
    return 0;
  }

  /// Get full image URL
  String get imageUrl {
    if (image.isEmpty) return '';
    if (image.startsWith('http')) return image;
    return '${_baseUrl}/$image';
  }

  static const String _baseUrl = 'https://www.balojicafe.com';
}

class MenuSize {
  final String label;
  final double price;

  MenuSize({required this.label, required this.price});

  factory MenuSize.fromJson(Map<String, dynamic> json) {
    return MenuSize(
      label: (json['label'] ?? '').toString(),
      price: (json['price'] is num) ? (json['price'] as num).toDouble() : 0,
    );
  }
}

class MenuAddon {
  final String label;
  final double price;

  MenuAddon({required this.label, required this.price});

  factory MenuAddon.fromJson(Map<String, dynamic> json) {
    return MenuAddon(
      label: (json['label'] ?? '').toString(),
      price: (json['price'] is num) ? (json['price'] as num).toDouble() : 0,
    );
  }
}

class MenuVenue {
  final int id;
  final String name;
  final String slug;
  final bool isMain;
  final bool acceptingOrders;

  MenuVenue({
    required this.id,
    required this.name,
    required this.slug,
    this.isMain = false,
    this.acceptingOrders = true,
  });

  factory MenuVenue.fromJson(Map<String, dynamic> json) {
    return MenuVenue(
      id: int.tryParse(json['id']?.toString() ?? '0') ?? 0,
      name: (json['name'] ?? '').toString(),
      slug: (json['slug'] ?? '').toString(),
      isMain: json['isMain'] == true,
      acceptingOrders: json['acceptingOrders'] != false,
    );
  }
}
