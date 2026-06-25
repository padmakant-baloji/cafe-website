class AppConstants {
  AppConstants._();

  // API
  static const String apiBaseUrl = 'https://www.quickkartcafe.com';

  // Storage keys
  static const String tokenKey = 'quickkartCustomerToken';
  static const String profileKey = 'quickkartCustomerProfile';
  static const String foodCartKey = 'quickkartFoodCart';
  static const String groceryCartKey = 'quickkartGroceryCart';
  static const String orderModeKey = 'quickkartOrderMode';

  // Cities
  static const List<String> cities = [
    'Kudachi',
    'Ugar',
    'Chinchali',
    'Ainapur',
    'Gundawad',
    'Shiragur',
  ];

  // Delivery
  static const double deliveryFee = 25.0;
  static const double freeDeliveryOver = 199.0;
  static const double minGroceryOrder = 49.0;

  // Branding
  static const String appName = "QuickKart";
  static const String tagline = 'Pure veg · Kudachi';
  static const String whatsappNumber = '+919876543210';
}
