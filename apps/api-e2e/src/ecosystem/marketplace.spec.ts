// The partner marketplace (092d). Offers only appear from an enabled partner linked to an Approved
// or Preferred vendor; a booking request is a quote and never a commitment; and nothing a partner
// says reaches the ledger.
import { expect, test } from '@playwright/test';
import {
  AuditEventList,
  BookingList,
  BookingView,
  BudgetDetail,
  OfferList,
  PartnerList,
  PartnerSyncResult,
  VendorList,
} from '@bf/contracts';
import { P16_IDS, SEED } from '@bf/seed';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { armPartnerAnswer } from './support';

/** Pulls both enabled partners' catalogues so the offer list is populated for this scenario. */
async function syncEnabledPartners(request: import('@playwright/test').APIRequestContext) {
  for (const partnerId of [P16_IDS.partners.cityQuest, P16_IDS.partners.freshPlate]) {
    const res = await request.post(`/api/ecosystem/marketplace/partners/${partnerId}/sync`, {
      headers: await mutate('integration-admin'),
    });
    await expectContract(res, 200, PartnerSyncResult);
  }
}

test.describe('partners', () => {
  test('a partner without an approved vendor cannot be enabled', async ({ request }) => {
    const partners = await expectContract(
      await request.get('/api/ecosystem/marketplace/partners', {
        headers: await as('integration-admin'),
      }),
      200,
      PartnerList,
    );
    const paused = partners.items.find((p) => p.id === P16_IDS.partners.kindlyGifts);
    expect(paused?.status).toBe('paused');
    expect(paused?.vendorId).toBeNull();
    await expectProblem(
      await request.patch(`/api/ecosystem/marketplace/partners/${P16_IDS.partners.kindlyGifts}`, {
        headers: await mutate('integration-admin'),
        data: { status: 'enabled' },
      }),
      422,
      'PARTNER_VENDOR_NOT_APPROVED',
    );
  });

  test('a blocked vendor cannot be the one behind a partner', async ({ request }) => {
    // Metro Party Rentals is seeded as a blocked vendor in the vendor master (106c).
    const vendors = await expectContract(
      await request.get('/api/finance/vendors', { headers: await as('finance-admin') }),
      200,
      VendorList,
    );
    const blocked = vendors.items.find((v) => v.status === 'blocked');
    expect(blocked, 'the seed has a blocked vendor to test with').toBeDefined();
    await expectProblem(
      await request.patch(`/api/ecosystem/marketplace/partners/${P16_IDS.partners.kindlyGifts}`, {
        headers: await mutate('integration-admin'),
        data: { vendorId: blocked!.id },
      }),
      422,
      'PARTNER_VENDOR_NOT_APPROVED',
    );
  });

  test('only an Integration Admin changes a partner', async ({ request }) => {
    await expectProblem(
      await request.patch(`/api/ecosystem/marketplace/partners/${P16_IDS.partners.cityQuest}`, {
        headers: await mutate('event-organizer'),
        data: { status: 'paused' },
      }),
      403,
      'FORBIDDEN',
    );
  });
});

test.describe('browsing', () => {
  test('offers come from enabled partners only, in a stable order', async ({ request }) => {
    await syncEnabledPartners(request);
    const list = await expectContract(
      await request.get('/api/marketplace/offers', { headers: await as('event-organizer') }),
      200,
      OfferList,
    );
    expect(list.items.length).toBeGreaterThan(0);
    const partners = new Set(list.items.map((o) => o.partnerName));
    expect(partners.has('CityQuest Experiences')).toBe(true);
    // The paused partner's catalogue was never pulled and would not show if it had been.
    expect(partners.has('Kindly Gifts')).toBe(false);

    const again = await expectContract(
      await request.get('/api/marketplace/offers', { headers: await as('event-organizer') }),
      200,
      OfferList,
    );
    expect(again.items.map((o) => o.id)).toEqual(list.items.map((o) => o.id));
  });

  test('filters narrow by city, category and the number of people', async ({ request }) => {
    await syncEnabledPartners(request);
    const hyderabad = await expectContract(
      await request.get('/api/marketplace/offers', {
        headers: await as('event-organizer'),
        params: { city: 'Hyderabad', category: 'catering' },
      }),
      200,
      OfferList,
    );
    expect(hyderabad.items.length).toBeGreaterThan(0);
    expect(hyderabad.items.every((o) => o.city === 'Hyderabad')).toBe(true);
    expect(hyderabad.items.every((o) => o.category === 'catering')).toBe(true);

    // A group far outside every seeded capacity band returns nothing rather than a bad suggestion.
    const huge = await expectContract(
      await request.get('/api/marketplace/offers', {
        headers: await as('event-organizer'),
        params: { people: 90_000 },
      }),
      200,
      OfferList,
    );
    expect(huge.items.length).toBe(0);
  });

  test('the marketplace of another tenant is empty, not someone else s catalogue', async ({
    request,
  }) => {
    await syncEnabledPartners(request);
    const hyland = await expectContract(
      await request.get('/api/marketplace/offers', { headers: await as('event-organizer') }),
      200,
      OfferList,
    );
    expect(hyland.items.length).toBeGreaterThan(0);
    const globex = await expectContract(
      await request.get('/api/marketplace/offers', { headers: await as('globex-admin') }),
      200,
      OfferList,
    );
    expect(globex.items.length).toBe(0);
  });
});

test.describe('booking', () => {
  test('a booking request waits for the partner and is never a commitment', async ({ request }) => {
    await syncEnabledPartners(request);
    const offers = await expectContract(
      await request.get('/api/marketplace/offers', {
        headers: await as('event-organizer'),
        params: { category: 'experiences' },
      }),
      200,
      OfferList,
    );
    const offer = offers.items[0];
    const booking = await expectContract(
      await request.post('/api/marketplace/bookings', {
        headers: await mutate('event-organizer'),
        data: {
          offerId: offer.id,
          eventId: SEED.p9.wellbeingEvent,
          peopleCount: Math.max(offer.capacityMin, 25),
          requestedDate: SEED.dates.open,
          notes: 'Afternoon slot preferred.',
        },
      }),
      201,
      BookingView,
    );
    expect(booking.status).toBe('waiting_for_partner');
    expect(booking.quotedPricePerHead).toBeNull();
    expect(booking.notice).toContain('becomes a commitment only');

    const events = await expectContract(
      await request.get('/api/audit/events', {
        headers: await as('auditor'),
        params: { resourceType: 'marketplace_booking', resourceId: booking.id, limit: 20 },
      }),
      200,
      AuditEventList,
    );
    expect(events.items.length, 'exactly one audit entry for the booking').toBe(1);
  });

  test('a group the offer cannot take is refused before the partner hears about it', async ({
    request,
  }) => {
    await syncEnabledPartners(request);
    const offers = await expectContract(
      await request.get('/api/marketplace/offers', {
        headers: await as('event-organizer'),
        params: { category: 'catering' },
      }),
      200,
      OfferList,
    );
    const offer = offers.items[0];
    await expectProblem(
      await request.post('/api/marketplace/bookings', {
        headers: await mutate('event-organizer'),
        data: {
          offerId: offer.id,
          eventId: SEED.p9.wellbeingEvent,
          peopleCount: offer.capacityMin - 1,
          requestedDate: SEED.dates.open,
        },
      }),
      422,
      'OFFER_NOT_AVAILABLE',
    );
  });

  test('the partner answer becomes a quote on the booking, with no money moved', async ({
    request,
  }) => {
    await syncEnabledPartners(request);
    const offers = await expectContract(
      await request.get('/api/marketplace/offers', {
        headers: await as('event-organizer'),
        params: { category: 'experiences' },
      }),
      200,
      OfferList,
    );
    const offer = offers.items[0];
    const before = await expectContract(
      await request.get(`/api/budgets/${SEED.budgets.bengaluru}`, {
        headers: await as('finance-admin'),
      }),
      200,
      BudgetDetail,
    );
    const booking = await expectContract(
      await request.post('/api/marketplace/bookings', {
        headers: await mutate('event-organizer'),
        data: {
          offerId: offer.id,
          eventId: SEED.p9.wellbeingEvent,
          peopleCount: Math.max(offer.capacityMin, 30),
          requestedDate: SEED.dates.open,
        },
      }),
      201,
      BookingView,
    );
    // The answer is armed against this booking id, so no other scenario can consume it.
    await armPartnerAnswer({
      bookingId: booking.id,
      available: true,
      reference: 'CQ-REF-0042',
      pricePerHeadMinor: 190_000,
      currency: 'INR',
    });
    const sync = await expectContract(
      await request.post(`/api/ecosystem/marketplace/partners/${P16_IDS.partners.cityQuest}/sync`, {
        headers: await mutate('integration-admin'),
      }),
      200,
      PartnerSyncResult,
    );
    expect(sync.bookingResponses).toBeGreaterThan(0);

    const list = await expectContract(
      await request.get('/api/marketplace/bookings', { headers: await as('event-organizer') }),
      200,
      BookingList,
    );
    const answered = list.items.find((b) => b.id === booking.id);
    expect(answered?.status).toBe('quoted');
    expect(answered?.partnerReference).toBe('CQ-REF-0042');
    expect(answered?.quotedPricePerHead?.amountMinor).toBe(190_000);
    expect(answered?.quotedPricePerHead?.currency).toBe('INR');

    const after = await expectContract(
      await request.get(`/api/budgets/${SEED.budgets.bengaluru}`, {
        headers: await as('finance-admin'),
      }),
      200,
      BudgetDetail,
    );
    // The budget behind the event is untouched: a partner quote is not an encumbrance, and nothing
    // in this phase can make it one.
    expect(after.balances.budgetCurrency.encumbered.amountMinor).toBe(
      before.balances.budgetCurrency.encumbered.amountMinor,
    );
    expect(after.balances.budgetCurrency.preEncumbered.amountMinor).toBe(
      before.balances.budgetCurrency.preEncumbered.amountMinor,
    );
  });
});
