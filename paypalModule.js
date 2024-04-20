const paypal = require('paypal-rest-sdk');

const payPalConfig = {
        mode: 'sandbox', //sandbox or live
        client_id: 'AQCp0u-hOnXI6Whdyrdb2E4QaskE5PWghl2tyUhUoZFY9pQQRy961hpKYdIs8ZfgcVInFtywieiaeqan',
        client_secret: 'EBxDXbOWTxRmk5rnjtaGDRVGnGDNSZt9AqZ-Z4UA-kGdGZGWgs5fYvuaovAODdM7tC147PusUsh4KccB'
    }
    // Configure PayPal with your client ID and secret
paypal.configure({
    'mode': 'sandbox', // Change to 'live' for production
    'client_id': payPalConfig.client_id,
    'client_secret': payPalConfig.client_secret
});
// Function to create a PayPal payment
const createPayment = (amount) => {
    return new Promise((resolve, reject) => {
        const paymentData = {
            "intent": "sale",
            "payer": {
                "payment_method": "paypal"
            },
            "redirect_urls": {
                "return_url": "https://docusign-node.onrender.com/simulatePayment",
                "cancel_url": "http://example.com/cancel"
            },
            "transactions": [{
                "amount": {
                    "total": amount,
                    "currency": "USD"
                },
                "description": "Payment description"
            }]
        };

        paypal.payment.create(paymentData, function(error, payment) {
            if (error) {
                reject(error);
            } else {
                const orderId = payment.id;
                const links = payment.links;
                let paymentLink = '';
                for (let i = 0; i < links.length; i++) {
                    if (links[i].method === 'REDIRECT') {
                        paymentLink = links[i].href;
                    }
                }
                resolve({ orderId, paymentLink });
            }
        });
    });
};

// Export the function to create a payment
module.exports.createPayment = createPayment;