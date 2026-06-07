import 'package:flutter/material.dart';
import '../models/menu_item.dart';
import '../services/api_service.dart';

class MenuProvider extends ChangeNotifier {
  final ApiService _api = ApiService();

  List<MenuCategory> _categories = [];
  List<MenuVenue> _venues = [];
  int? _selectedVenueId;

  bool _isLoading = false;
  bool _loaded = false;
  String? _error;
  bool _acceptingOrders = true;
  String? _storeNotice;

  List<MenuCategory> get categories => _categories;
  List<MenuVenue> get venues => _venues;
  int? get selectedVenueId => _selectedVenueId;
  
  List<MenuCategory> get activeCategories {
    if (_selectedVenueId == null) return _categories;
    return _categories.where((c) => c.venueId == _selectedVenueId).toList();
  }

  bool get isLoading => _isLoading;
  bool get loaded => _loaded;
  String? get error => _error;
  bool get acceptingOrders => _acceptingOrders;
  String? get storeNotice => _storeNotice;

  void selectVenue(int venueId) {
    if (_selectedVenueId == venueId) return;
    _selectedVenueId = venueId;
    
    try {
      final venue = _venues.firstWhere((v) => v.id == venueId);
      _acceptingOrders = venue.acceptingOrders;
    } catch (_) {}
    
    notifyListeners();
  }

  Future<void> loadMenu({bool force = false}) async {
    if (_loaded && !force) return;
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final data = await _api.getMenu();

      if (data['venues'] is List) {
        _venues = (data['venues'] as List)
            .map((v) => v is Map<String, dynamic> ? MenuVenue.fromJson(v) : null)
            .whereType<MenuVenue>()
            .toList();
            
        if (_venues.isNotEmpty && _selectedVenueId == null) {
          final mainVenue = _venues.firstWhere((v) => v.isMain, orElse: () => _venues.first);
          _selectedVenueId = mainVenue.id;
          _acceptingOrders = mainVenue.acceptingOrders;
        }
      }

      // The API returns either { categories: [...] } or the menu.json structure
      List<dynamic> catList = [];
      if (data['categories'] is List) {
        catList = data['categories'] as List;
      } else if (data['menu'] is Map && data['menu']['categories'] is List) {
        catList = data['menu']['categories'] as List;
      }

      _categories = catList
          .map((c) => c is Map<String, dynamic> ? MenuCategory.fromJson(c) : null)
          .whereType<MenuCategory>()
          .toList();

      _loaded = true;
      _isLoading = false;
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> loadStoreStatus() async {
    try {
      final data = await _api.getStoreStatus();
      if (_venues.isEmpty || _selectedVenueId == _venues.firstWhere((v) => v.isMain, orElse: () => _venues.first).id) {
        _acceptingOrders = data['acceptingOrders'] != false;
      }
      _storeNotice = data['notice']?.toString();
      notifyListeners();
    } catch (_) {
      _acceptingOrders = true;
    }
  }

  /// Search across all categories
  List<MenuItem> search(String query) {
    if (query.trim().isEmpty) return [];
    final q = query.trim().toLowerCase();
    final results = <MenuItem>[];
    for (final cat in _categories) {
      for (final item in cat.allItems) {
        if (item.name.toLowerCase().contains(q)) {
          results.add(item);
        }
      }
    }
    return results;
  }
}
