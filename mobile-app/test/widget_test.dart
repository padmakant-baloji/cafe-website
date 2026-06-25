import 'package:flutter_test/flutter_test.dart';
import 'package:quickkart_cafe/main.dart';

void main() {
  testWidgets('App launches', (WidgetTester tester) async {
    await tester.pumpWidget(const QuickKartCafeApp());
    // Verify splash screen is displayed
    expect(find.text("QuickKart's Cafe"), findsOneWidget);
  });
}
