const db_shopid = [{ shopid: "shop123", transactionid_: "trans456" }];


if (db_shopid.length) {
    console.log({ status: 402, message: "You have already completed this transaction." });
}else{
    console.log("Transaction not found, proceed with order creation.");
}