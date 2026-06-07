class Customer {
  final String mobile;
  final String name;
  final String city;
  final List<Address> addresses;

  Customer({
    required this.mobile,
    required this.name,
    required this.city,
    this.addresses = const [],
  });

  factory Customer.fromJson(Map<String, dynamic> json) {
    final addressList = json['addresses'];
    List<Address> addresses = [];
    if (addressList is List) {
      addresses = addressList
          .map((a) => a is Map<String, dynamic> ? Address.fromJson(a) : null)
          .whereType<Address>()
          .toList();
    }

    return Customer(
      mobile: (json['mobile'] ?? json['customerId'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      city: (json['city'] ?? '').toString(),
      addresses: addresses,
    );
  }

  Map<String, dynamic> toJson() => {
    'mobile': mobile,
    'name': name,
    'city': city,
    'addresses': addresses.map((a) => a.toJson()).toList(),
  };

  String get initials {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).take(2).toList();
    if (parts.isEmpty) return 'B';
    return parts.map((p) => p[0].toUpperCase()).join();
  }

  Address? get defaultAddress {
    if (addresses.isEmpty) return null;
    return addresses.firstWhere(
      (a) => a.isDefault,
      orElse: () => addresses.first,
    );
  }

  Customer copyWith({
    String? mobile,
    String? name,
    String? city,
    List<Address>? addresses,
  }) {
    return Customer(
      mobile: mobile ?? this.mobile,
      name: name ?? this.name,
      city: city ?? this.city,
      addresses: addresses ?? this.addresses,
    );
  }
}

class Address {
  final dynamic id;
  final String label;
  final String addressLine;
  final String city;
  final bool isDefault;

  Address({
    this.id,
    this.label = 'Delivery',
    required this.addressLine,
    this.city = '',
    this.isDefault = false,
  });

  factory Address.fromJson(Map<String, dynamic> json) {
    return Address(
      id: json['id'],
      label: (json['label'] ?? 'Delivery').toString(),
      addressLine: (json['addressLine'] ?? json['address_line'] ?? '').toString(),
      city: (json['city'] ?? '').toString(),
      isDefault: json['isDefault'] == true || json['is_default'] == true,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'label': label,
    'addressLine': addressLine,
    'city': city,
    'isDefault': isDefault,
  };

  String get displayLine => addressLine.trim();
}
