/**
 * Recorded extraction readings for the offline `RecordedAiProvider`, keyed by the document's file
 * name (the seeded receipts and quote, and the receipts the API scenarios upload under the same
 * names). Values are what a careful person reads from the fictional document; card digits,
 * signatures and contact details are never among the fields.
 */
export interface RecordedField {
  field: string;
  value: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export const RECORDED_DOCUMENTS: Readonly<Record<string, readonly RecordedField[]>> = {
  'receipt-cafe-mocha.pdf': [
    { field: 'merchant', value: 'Cafe Mocha, Indiranagar', confidence: 'high' },
    { field: 'receiptDate', value: '2026-10-18', confidence: 'high' },
    { field: 'totalMinor', value: '456000', confidence: 'high' },
    { field: 'taxNote', value: 'GST included', confidence: 'medium' },
    { field: 'paymentMethod', value: 'Card payment', confidence: 'medium' },
  ],
  'receipt-westlake-hotel.pdf': [
    { field: 'merchant', value: 'Hotel Westlake', confidence: 'high' },
    { field: 'receiptDate', value: '2026-11-03', confidence: 'high' },
    { field: 'totalMinor', value: '124000', confidence: 'high' },
    { field: 'taxNote', value: null, confidence: 'low' },
  ],
  'quote-deccan-kitchen.pdf': [
    { field: 'vendorName', value: 'Deccan Kitchen Co', confidence: 'high' },
    { field: 'totalMinor', value: '27900000', confidence: 'high' },
    { field: 'validUntil', value: '2026-11-15', confidence: 'high' },
    { field: 'depositPct', value: '30', confidence: 'medium' },
    { field: 'cancellationTerms', value: 'Free until 2026-11-25', confidence: 'medium' },
  ],
};
