/**
 * Stripe Service - Kevin's Treasury
 * Handles all payment operations for Apex Voice Solutions
 */

const Stripe = require('stripe');

// Initialize Stripe - MUST set STRIPE_SECRET_KEY in Railway environment variables
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Product IDs for Apex Voice Services
 * These should be created in Stripe Dashboard
 */
const PRODUCTS = {
  SETUP_BASIC: 'setup_basic',      // $500
  SETUP_STANDARD: 'setup_standard', // $1,500
  SETUP_PREMIUM: 'setup_premium',   // $3,500
  RETAINER_BASIC: 'retainer_basic', // $250/mo
  RETAINER_STANDARD: 'retainer_standard', // $500/mo
  RETAINER_PREMIUM: 'retainer_premium' // $2,000/mo
};

/**
 * Create a payment link for setup fee
 */
async function createSetupPaymentLink(clientId, amount, description) {
  try {
    // Create a product if needed
    const product = await stripe.products.create({
      name: `AI Receptionist Setup - ${description}`,
      metadata: { client_id: clientId }
    });

    // Create a price
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: amount * 100, // Convert to cents
      currency: 'usd',
    });

    // Create payment link
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { client_id: clientId, type: 'setup_fee' },
      after_completion: {
        type: 'redirect',
        redirect: { url: `https://crm.apexvoicesolutions.org/clients/${clientId}?payment=success` }
      }
    });

    return {
      success: true,
      paymentLink: paymentLink.url,
      priceId: price.id,
      productId: product.id
    };
  } catch (error) {
    console.error('Stripe payment link error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Create a customer in Stripe
 */
async function createCustomer(email, name, metadata = {}) {
  try {
    const customer = await stripe.customers.create({
      email,
      name,
      metadata
    });
    return { success: true, customer };
  } catch (error) {
    console.error('Stripe customer creation error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Create a subscription for monthly retainer
 */
async function createSubscription(customerId, priceId, metadata = {}) {
  try {
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      metadata,
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent']
    });
    return { success: true, subscription };
  } catch (error) {
    console.error('Stripe subscription error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get all payments for a client
 */
async function getClientPayments(customerId) {
  try {
    const charges = await stripe.charges.list({
      customer: customerId,
      limit: 100
    });
    return { success: true, charges: charges.data };
  } catch (error) {
    console.error('Stripe get payments error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get subscription status
 */
async function getSubscriptionStatus(subscriptionId) {
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    return {
      success: true,
      status: subscription.status,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end
    };
  } catch (error) {
    console.error('Stripe subscription status error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Cancel subscription
 */
async function cancelSubscription(subscriptionId) {
  try {
    const subscription = await stripe.subscriptions.cancel(subscriptionId);
    return { success: true, subscription };
  } catch (error) {
    console.error('Stripe cancel subscription error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Create invoice for usage-based billing
 */
async function createUsageInvoice(customerId, amount, description, metadata = {}) {
  try {
    // Create invoice item
    await stripe.invoiceItems.create({
      customer: customerId,
      amount: amount * 100,
      currency: 'usd',
      description,
      metadata
    });

    // Create invoice
    const invoice = await stripe.invoices.create({
      customer: customerId,
      auto_advance: true // Auto-finalize and send
    });

    return { success: true, invoice };
  } catch (error) {
    console.error('Stripe invoice error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Verify webhook signature
 */
function verifyWebhookSignature(payload, signature, secret) {
  try {
    const event = stripe.webhooks.constructEvent(payload, signature, secret);
    return { success: true, event };
  } catch (error) {
    console.error('Webhook verification failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get balance and revenue stats
 */
async function getRevenueStats() {
  try {
    const balance = await stripe.balance.retrieve();
    
    // Get recent charges
    const charges = await stripe.charges.list({ limit: 100 });
    
    const totalRevenue = charges.data
      .filter(c => c.status === 'succeeded')
      .reduce((sum, c) => sum + c.amount, 0) / 100;

    return {
      success: true,
      available: balance.available[0]?.amount / 100 || 0,
      pending: balance.pending[0]?.amount / 100 || 0,
      totalRevenue,
      currency: 'usd'
    };
  } catch (error) {
    console.error('Stripe revenue stats error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  stripe,
  PRODUCTS,
  createSetupPaymentLink,
  createCustomer,
  createSubscription,
  getClientPayments,
  getSubscriptionStatus,
  cancelSubscription,
  createUsageInvoice,
  verifyWebhookSignature,
  getRevenueStats
};
