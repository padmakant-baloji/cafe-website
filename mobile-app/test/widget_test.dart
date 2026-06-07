import 'package:flutter_test/flutter_test.dart';
import 'package:baloji_cafe/main.dart';

void main() {
  testWidgets('App launches', (WidgetTester tester) async {
    await tester.pumpWidget(const BalojiCafeApp());
    // Verify splash screen is displayed
    expect(find.text("Baloji's Cafe"), findsOneWidget);
  });
}
