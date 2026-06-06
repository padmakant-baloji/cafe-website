'use strict';

function parseFloorPaymentInput(body, total) {
    const expectedTotal = parseInt(String(total), 10);
    if (!Number.isFinite(expectedTotal) || expectedTotal < 0) {
        throw Object.assign(new Error('Invalid order total.'), { statusCode: 400 });
    }

    const pm = String((body && body.payment_method) || '').trim().toUpperCase();
    if (pm === 'SPLIT' || pm === 'PART') {
        const cash = parseInt(String((body && (body.payment_cash ?? body.cash)) ?? ''), 10);
        const upi = parseInt(String((body && (body.payment_upi ?? body.upi)) ?? ''), 10);
        if (!Number.isFinite(cash) || cash < 0 || !Number.isFinite(upi) || upi < 0) {
            throw Object.assign(new Error('Enter valid cash and UPI amounts.'), { statusCode: 400 });
        }
        if (cash === 0 && upi === 0) {
            throw Object.assign(new Error('Enter at least one payment amount.'), { statusCode: 400 });
        }
        if (cash + upi !== expectedTotal) {
            throw Object.assign(
                new Error(`Cash + UPI must equal ₹${expectedTotal}.`),
                { statusCode: 400 }
            );
        }
        return {
            payment_method: 'SPLIT',
            payment_cash: cash,
            payment_upi: upi
        };
    }

    if (pm === 'CASH' || pm === 'UPI') {
        return {
            payment_method: pm,
            payment_cash: pm === 'CASH' ? expectedTotal : 0,
            payment_upi: pm === 'UPI' ? expectedTotal : 0
        };
    }

    throw Object.assign(new Error('Choose payment: CASH, UPI, or SPLIT.'), { statusCode: 400 });
}

function buildFloorMetaPayment(meta, payment) {
    return {
        ...meta,
        payment_method: payment.payment_method,
        payment_cash: payment.payment_cash,
        payment_upi: payment.payment_upi
    };
}

module.exports = { parseFloorPaymentInput, buildFloorMetaPayment };
