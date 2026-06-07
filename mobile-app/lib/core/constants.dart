class AppConstants {
  AppConstants._();

  // API
  static const String apiBaseUrl = 'https://www.balojicafe.com';

  // Storage keys
  static const String tokenKey = 'balojiCustomerToken';
  static const String profileKey = 'balojiCustomerProfile';
  static const String foodCartKey = 'balojiFoodCart';
  static const String groceryCartKey = 'balojiGroceryCart';
  static const String orderModeKey = 'balojiOrderMode';

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
  static const String appName = "Baloji";
  static const String tagline = 'Pure veg · Kudachi';
  static const String whatsappNumber = '+919876543210';
}
