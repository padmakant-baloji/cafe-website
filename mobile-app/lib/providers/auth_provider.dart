import 'package:flutter/material.dart';
import '../models/customer.dart';
import '../services/api_service.dart';
import '../services/storage_service.dart';

class AuthProvider extends ChangeNotifier {
  final ApiService _api = ApiService();
  final StorageService _storage = StorageService();

  Customer? _customer;
  bool _isLoading = false;
  bool _isInitialized = false;
  String? _error;

  Customer? get customer => _customer;
  bool get isLoading => _isLoading;
  bool get isLoggedIn => _customer != null && (_storage.token?.isNotEmpty ?? false);
  bool get isInitialized => _isInitialized;
  String? get error => _error;

  /// Try restoring a saved session on app start
  Future<bool> restoreSession() async {
    final token = _storage.token;
    if (token == null || token.isEmpty) {
      _isInitialized = true;
      notifyListeners();
      return false;
    }

    // Load cached profile first for instant UI
    final cached = _storage.profile;
    if (cached != null) {
      _customer = Customer.fromJson(cached);
      notifyListeners();
    }

    try {
      final data = await _api.getMe();
      if (data['customer'] != null) {
        _customer = Customer.fromJson(data['customer'] as Map<String, dynamic>);
        await _storage.setProfile(_customer!.toJson());
      }
      _isInitialized = true;
      notifyListeners();
      return true;
    } catch (_) {
      await _storage.setToken(null);
      await _storage.setProfile(null);
      _customer = null;
      _isInitialized = true;
      notifyListeners();
      return false;
    }
  }

  /// Lookup mobile: returns true if exists (auto-login), false if new
  Future<bool> lookupMobile(String mobile) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final data = await _api.lookupMobile(mobile);
      if (data['exists'] == true && data['token'] != null) {
        await _storage.setToken(data['token'].toString());
        if (data['customer'] != null) {
          _customer = Customer.fromJson(data['customer'] as Map<String, dynamic>);
          await _storage.setProfile(_customer!.toJson());
        }
        _isLoading = false;
        notifyListeners();
        return true;
      }
      _isLoading = false;
      notifyListeners();
      return false;
    } catch (e) {
      _error = e.toString();
      _isLoading = false;
      notifyListeners();
      rethrow;
    }
  }

  /// Register new customer
  Future<void> register({
    required String mobile,
    required String name,
    required String city,
    required String addressLine,
  }) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final data = await _api.register(
        mobile: mobile,
        name: name,
        city: city,
        addressLine: addressLine,
      );
      await _storage.setToken(data['token']?.toString());
      if (data['customer'] != null) {
        _customer = Customer.fromJson(data['customer'] as Map<String, dynamic>);
        await _storage.setProfile(_customer!.toJson());
      }
      _isLoading = false;
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      _isLoading = false;
      notifyListeners();
      rethrow;
    }
  }

  /// Update profile (name, city)
  Future<void> updateProfile({required String name, required String city}) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final data = await _api.updateProfile(name: name, city: city);
      if (data['customer'] != null) {
        _customer = Customer.fromJson(data['customer'] as Map<String, dynamic>);
        await _storage.setProfile(_customer!.toJson());
      }
      _isLoading = false;
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      _isLoading = false;
      notifyListeners();
      rethrow;
    }
  }

  /// Update/create address
  Future<void> updateAddress({
    String? addressId,
    required String addressLine,
    required String city,
  }) async {
    try {
      final data = await _api.updateAddress(
        addressId: addressId,
        addressLine: addressLine,
        city: city,
      );
      if (data['customer'] != null) {
        _customer = Customer.fromJson(data['customer'] as Map<String, dynamic>);
        await _storage.setProfile(_customer!.toJson());
      }
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      rethrow;
    }
  }

  /// Refresh profile from server
  Future<void> refreshProfile() async {
    try {
      final data = await _api.getMe();
      if (data['customer'] != null) {
        _customer = Customer.fromJson(data['customer'] as Map<String, dynamic>);
        await _storage.setProfile(_customer!.toJson());
        notifyListeners();
      }
    } catch (_) {
      // Silent fail for background refresh
    }
  }

  /// Sign out
  Future<void> signOut() async {
    await _storage.clearSession();
    _customer = null;
    _error = null;
    notifyListeners();
  }

  void clearError() {
    _error = null;
    notifyListeners();
  }
}
