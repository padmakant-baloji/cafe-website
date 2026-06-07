import 'dart:convert';
import 'package:http/http.dart' as http;
import '../core/constants.dart';
import 'storage_service.dart';

class ApiService {
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  final String _baseUrl = AppConstants.apiBaseUrl;
  final http.Client _client = http.Client();

  Map<String, String> _headers({bool auth = false}) {
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (auth) {
      final token = StorageService().token;
      if (token != null && token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }
      final profile = StorageService().profile;
      if (profile != null && profile['mobile'] != null) {
        headers['x-customer-mobile'] = profile['mobile'].toString();
      }
    }
    return headers;
  }

  // ── Auth ──

  Future<Map<String, dynamic>> lookupMobile(String mobile) async {
    final res = await _client.post(
      Uri.parse('$_baseUrl/api/auth/lookup'),
      headers: _headers(),
      body: jsonEncode({'mobile': mobile}),
    );
    return _handleResponse(res);
  }

  Future<Map<String, dynamic>> register({
    required String mobile,
    required String name,
    required String city,
    required String addressLine,
  }) async {
    final res = await _client.post(
      Uri.parse('$_baseUrl/api/auth/register'),
      headers: _headers(),
      body: jsonEncode({
        'mobile': mobile,
        'name': name,
        'city': city,
        'addressLine': addressLine,
      }),
    );
    return _handleResponse(res);
  }

  Future<Map<String, dynamic>> getMe() async {
    final res = await _client.get(
      Uri.parse('$_baseUrl/api/auth/me'),
      headers: _headers(auth: true),
    );
    return _handleResponse(res);
  }

  Future<Map<String, dynamic>> updateProfile({
    required String name,
    required String city,
  }) async {
    final res = await _client.patch(
      Uri.parse('$_baseUrl/api/auth/profile'),
      headers: _headers(auth: true),
      body: jsonEncode({'name': name, 'city': city}),
    );
    return _handleResponse(res);
  }

  Future<Map<String, dynamic>> updateAddress({
    String? addressId,
    required String addressLine,
    required String city,
  }) async {
    final body = <String, dynamic>{
      'addressLine': addressLine,
      'city': city,
    };
    if (addressId != null) body['addressId'] = addressId;
    final res = await _client.patch(
      Uri.parse('$_baseUrl/api/auth/address'),
      headers: _headers(auth: true),
      body: jsonEncode(body),
    );
    return _handleResponse(res);
  }

  // ── Menu ──

  Future<Map<String, dynamic>> getMenu() async {
    final res = await _client.get(
      Uri.parse('$_baseUrl/api/menu'),
      headers: _headers(),
    );
    return _handleResponse(res);
  }

  // ── Store Status ──

  Future<Map<String, dynamic>> getStoreStatus() async {
    final res = await _client.get(
      Uri.parse('$_baseUrl/api/store-status'),
      headers: _headers(),
    );
    return _handleResponse(res);
  }

  // ── Orders ──

  Future<Map<String, dynamic>> placeOrder(Map<String, dynamic> orderData) async {
    final res = await _client.post(
      Uri.parse('$_baseUrl/api/order'),
      headers: _headers(auth: true),
      body: jsonEncode(orderData),
    );
    return _handleResponse(res);
  }

  Future<Map<String, dynamic>> getMyOrders() async {
    final res = await _client.get(
      Uri.parse('$_baseUrl/api/orders/my'),
      headers: _headers(auth: true),
    );
    return _handleResponse(res);
  }

  Future<Map<String, dynamic>> cancelOrder(int orderId) async {
    final res = await _client.post(
      Uri.parse('$_baseUrl/api/orders/$orderId/cancel'),
      headers: _headers(auth: true),
    );
    return _handleResponse(res);
  }

  // ── Coupons ──

  Future<Map<String, dynamic>> validateCoupon(String code, double subtotal) async {
    final res = await _client.post(
      Uri.parse('$_baseUrl/api/coupons/validate'),
      headers: _headers(auth: true),
      body: jsonEncode({'code': code, 'subtotal': subtotal}),
    );
    return _handleResponse(res);
  }

  // ── Grocery ──

  Future<Map<String, dynamic>> getGroceryStorefront() async {
    final res = await _client.get(
      Uri.parse('$_baseUrl/api/grocery'),
      headers: _headers(),
    );
    return _handleResponse(res);
  }

  Future<Map<String, dynamic>> placeGroceryOrder(Map<String, dynamic> orderData) async {
    final res = await _client.post(
      Uri.parse('$_baseUrl/api/grocery/order'),
      headers: _headers(auth: true),
      body: jsonEncode(orderData),
    );
    return _handleResponse(res);
  }

  // ── Response handling ──

  Map<String, dynamic> _handleResponse(http.Response res) {
    Map<String, dynamic> data;
    try {
      data = jsonDecode(res.body) as Map<String, dynamic>;
    } catch (_) {
      data = {};
    }

    if (res.statusCode >= 200 && res.statusCode < 300) {
      return data;
    }

    final errorMsg = data['error']?.toString() ??
        _defaultErrorMessage(res.statusCode);
    throw ApiException(errorMsg, res.statusCode);
  }

  String _defaultErrorMessage(int statusCode) {
    if (statusCode == 401) return 'Session expired. Please sign in again.';
    if (statusCode == 404) return 'Could not reach the server. Please try again.';
    if (statusCode == 502 || statusCode == 503) return 'Server is busy. Please try again in a moment.';
    if (statusCode >= 500) return 'Server error. Please try again later.';
    return 'Something went wrong. Please try again.';
  }
}

class ApiException implements Exception {
  final String message;
  final int statusCode;

  ApiException(this.message, this.statusCode);

  @override
  String toString() => message;
}
