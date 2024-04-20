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

// Create a payment request
const createPayment = (callback) => {
    const paymentData = {
        "intent": "sale",
        "payer": {
            "payment_method": "paypal"
        },
        "redirect_urls": {
            "return_url": "http://example.com/success",
            "cancel_url": "http://example.com/cancel"
        },
        "transactions": [{
            "amount": {
                "total": "10.00",
                "currency": "USD"
            },
            "description": "Description of the payment"
        }]
    };

    paypal.payment.create(paymentData, function(error, payment) {
        if (error) {
            callback(error);
        } else {
            const links = payment.links;
            let link = '';
            for (let i = 0; i < links.length; i++) {
                if (links[i].method === 'REDIRECT') {
                    link = links[i].href;
                }
            }
            callback(null, link);
        }
    });
};

// Call the createPayment function
createPayment(function(error, link) {
    if (error) {
        console.error(error);
    } else {
        console.log("Payment link:", link);
    }
});