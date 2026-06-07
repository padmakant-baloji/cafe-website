import 'package:flutter/material.dart';
import '../core/theme.dart';

class StoreStatusBadge extends StatelessWidget {
  final bool isOpen;
  final bool compact;

  const StoreStatusBadge({
    super.key,
    required this.isOpen,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 8 : 10,
        vertical: compact ? 3 : 5,
      ),
      decoration: BoxDecoration(
        color: (isOpen ? AppTheme.primary : AppTheme.error).withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(AppTheme.radiusFull),
        border: Border.all(
          color: (isOpen ? AppTheme.primary : AppTheme.error).withValues(alpha: 0.3),
          width: 1,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(
              color: isOpen ? AppTheme.primary : AppTheme.error,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: (isOpen ? AppTheme.primary : AppTheme.error).withValues(alpha: 0.5),
                  blurRadius: 4,
                ),
              ],
            ),
          ),
          SizedBox(width: compact ? 5 : 6),
          Text(
            isOpen ? 'Open now' : 'Closed',
            style: TextStyle(
              fontSize: compact ? 11 : 12,
              fontWeight: FontWeight.w600,
              color: isOpen ? AppTheme.primary : AppTheme.error,
            ),
          ),
        ],
      ),
    );
  }
}
