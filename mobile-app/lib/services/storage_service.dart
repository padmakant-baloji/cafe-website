import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/constants.dart';

class StorageService {
  static final StorageService _instance = StorageService._internal();
  factory StorageService() => _instance;
  StorageService._internal();

  SharedPreferences? _prefs;

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
  }

  SharedPreferences get _p {
    if (_prefs == null) throw StateError('StorageService not initialized. Call init() first.');
    return _prefs!;
  }

  // ── Token ──

  String? get token => _p.getString(AppConstants.tokenKey);

  Future<void> setToken(String? value) async {
    if (value == null || value.isEmpty) {
      await _p.remove(AppConstants.tokenKey);
    } else {
      await _p.setString(AppConstants.tokenKey, value);
    }
  }

  // ── Profile ──

  Map<String, dynamic>? get profile {
    final raw = _p.getString(AppConstants.profileKey);
    if (raw == null) return null;
    try {
      final parsed = jsonDecode(raw);
      return parsed is Map<String, dynamic> ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  Future<void> setProfile(Map<String, dynamic>? value) async {
    if (value == null) {
      await _p.remove(AppConstants.profileKey);
    } else {
      await _p.setString(AppConstants.profileKey, jsonEncode(value));
    }
  }

  // ── Food Cart ──

  List<Map<String, dynamic>> get foodCart {
    final raw = _p.getString(AppConstants.foodCartKey);
    if (raw == null) return [];
    try {
      final parsed = jsonDecode(raw);
      if (parsed is List) {
        return parsed.cast<Map<String, dynamic>>();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  Future<void> setFoodCart(List<Map<String, dynamic>> items) async {
    await _p.setString(AppConstants.foodCartKey, jsonEncode(items));
  }

  // ── Grocery Cart ──

  List<Map<String, dynamic>> get groceryCart {
    final raw = _p.getString(AppConstants.groceryCartKey);
    if (raw == null) return [];
    try {
      final parsed = jsonDecode(raw);
      if (parsed is List) {
        return parsed.cast<Map<String, dynamic>>();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  Future<void> setGroceryCart(List<Map<String, dynamic>> items) async {
    await _p.setString(AppConstants.groceryCartKey, jsonEncode(items));
  }

  // ── Order Mode ──

  String get orderMode => _p.getString(AppConstants.orderModeKey) ?? 'food';

  Future<void> setOrderMode(String mode) async {
    await _p.setString(AppConstants.orderModeKey, mode);
  }

  // ── Clear all ──

  Future<void> clearSession() async {
    await _p.remove(AppConstants.tokenKey);
    await _p.remove(AppConstants.profileKey);
  }

  Future<void> clearAll() async {
    await _p.clear();
  }
}
