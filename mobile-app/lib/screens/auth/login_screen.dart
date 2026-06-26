import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/theme.dart';
import '../../core/constants.dart';
import '../../core/routes.dart';
import '../../providers/auth_provider.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _mobileController = TextEditingController();
  final _nameController = TextEditingController();
  final _addressController = TextEditingController();
  String _selectedCity = '';
  bool _showRegister = false;
  bool _isLoading = false;
  String? _error;

  @override
  void dispose() {
    _mobileController.dispose();
    _nameController.dispose();
    _addressController.dispose();
    super.dispose();
  }

  String _sanitizeMobile(String raw) {
    return raw.replaceAll(RegExp(r'\D'), '').replaceFirst(RegExp(r'^91'), '').replaceFirst(RegExp(r'^\+91'), '');
  }

  Future<void> _onContinue() async {
    final mobile = _sanitizeMobile(_mobileController.text).length > 10
        ? _sanitizeMobile(_mobileController.text).substring(_sanitizeMobile(_mobileController.text).length - 10)
        : _sanitizeMobile(_mobileController.text);

    if (mobile.length != 10) {
      setState(() => _error = 'Enter a valid 10-digit mobile number.');
      return;
    }

    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final auth = context.read<AuthProvider>();
      final exists = await auth.lookupMobile(mobile);

      if (!mounted) return;

      if (exists) {
        Navigator.pushReplacementNamed(context, AppRoutes.home);
      } else {
        setState(() {
          _showRegister = true;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  Future<void> _onRegister() async {
    final mobile = _sanitizeMobile(_mobileController.text).length > 10
        ? _sanitizeMobile(_mobileController.text).substring(_sanitizeMobile(_mobileController.text).length - 10)
        : _sanitizeMobile(_mobileController.text);
    final name = _nameController.text.trim();
    final city = _selectedCity;
    final address = _addressController.text.trim();

    if (mobile.length != 10) {
      setState(() => _error = 'Invalid mobile number.');
      return;
    }
    if (name.isEmpty || city.isEmpty) {
      setState(() => _error = 'Please enter your name and select a city.');
      return;
    }
    if (address.isEmpty) {
      setState(() => _error = 'Please enter your delivery address (street or landmark).');
      return;
    }

    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final auth = context.read<AuthProvider>();
      await auth.register(
        mobile: mobile,
        name: name,
        city: city,
        addressLine: address,
      );

      if (!mounted) return;
      Navigator.pushReplacementNamed(context, AppRoutes.home);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: AppTheme.backgroundGradient),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Container(
                constraints: const BoxConstraints(maxWidth: 400),
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: AppTheme.surface.withValues(alpha: 0.92),
                  borderRadius: BorderRadius.circular(AppTheme.radiusLg),
                  border: Border.all(color: AppTheme.cardBorder),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.35),
                      blurRadius: 50,
                      offset: const Offset(0, 20),
                    ),
                  ],
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Header
                    const Text(
                      "Baloji Cafe",
                      style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w700,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      _showRegister
                          ? 'New customer: name, city, and where we deliver.'
                          : 'Enter your mobile number to continue.',
                      style: const TextStyle(
                        fontSize: 14,
                        color: AppTheme.textSecondary,
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 24),

                    // Mobile step
                    if (!_showRegister) ...[
                      _buildLabel('MOBILE NUMBER'),
                      const SizedBox(height: 6),
                      TextField(
                        controller: _mobileController,
                        keyboardType: TextInputType.phone,
                        autofocus: true,
                        style: const TextStyle(color: AppTheme.textPrimary, fontSize: 16),
                        decoration: InputDecoration(
                          hintText: '10-digit mobile (with or without +91)',
                          prefixIcon: const Padding(
                            padding: EdgeInsets.only(left: 12, right: 4),
                            child: Text('+91', style: TextStyle(fontSize: 16, color: AppTheme.textSecondary)),
                          ),
                          prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
                        ),
                        onSubmitted: (_) => _onContinue(),
                      ),
                      const SizedBox(height: 16),
                      _buildPrimaryButton('Continue', _onContinue),
                    ],

                    // Register step
                    if (_showRegister) ...[
                      _buildLabel('NAME'),
                      const SizedBox(height: 6),
                      TextField(
                        controller: _nameController,
                        textCapitalization: TextCapitalization.words,
                        style: const TextStyle(color: AppTheme.textPrimary, fontSize: 16),
                        decoration: const InputDecoration(hintText: 'Your name'),
                      ),
                      const SizedBox(height: 16),
                      _buildLabel('CITY'),
                      const SizedBox(height: 6),
                      DropdownButtonFormField<String>(
                        value: _selectedCity.isEmpty ? null : _selectedCity,
                        decoration: const InputDecoration(hintText: 'Select your city'),
                        dropdownColor: AppTheme.surface,
                        style: const TextStyle(color: AppTheme.textPrimary, fontSize: 16),
                        items: AppConstants.cities.map((city) {
                          return DropdownMenuItem(value: city, child: Text(city));
                        }).toList(),
                        onChanged: (val) => setState(() => _selectedCity = val ?? ''),
                      ),
                      const SizedBox(height: 16),
                      _buildLabel('DELIVERY ADDRESS'),
                      const SizedBox(height: 6),
                      TextField(
                        controller: _addressController,
                        textCapitalization: TextCapitalization.sentences,
                        style: const TextStyle(color: AppTheme.textPrimary, fontSize: 16),
                        decoration: const InputDecoration(hintText: 'House no., street, landmark'),
                      ),
                      const SizedBox(height: 20),
                      _buildPrimaryButton('Start ordering', _onRegister),
                      const SizedBox(height: 8),
                      Center(
                        child: TextButton(
                          onPressed: () => setState(() {
                            _showRegister = false;
                            _error = null;
                          }),
                          child: const Text('← Back to mobile', style: TextStyle(color: AppTheme.textSecondary)),
                        ),
                      ),
                    ],

                    // Error
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      Text(
                        _error!,
                        style: const TextStyle(fontSize: 13, color: AppTheme.errorLight),
                      ),
                    ],

                    // Legal
                    const SizedBox(height: 16),
                    const Center(
                      child: Text(
                        'Privacy Policy',
                        style: TextStyle(fontSize: 12, color: AppTheme.textMuted),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildLabel(String text) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w700,
        color: AppTheme.textSecondary,
        letterSpacing: 0.8,
      ),
    );
  }

  Widget _buildPrimaryButton(String label, VoidCallback onTap) {
    return SizedBox(
      width: double.infinity,
      height: 48,
      child: ElevatedButton(
        onPressed: _isLoading ? null : onTap,
        child: _isLoading
            ? const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2.5,
                  color: Colors.white,
                ),
              )
            : Text(label),
      ),
    );
  }
}
