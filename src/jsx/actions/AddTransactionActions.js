import alt from '../alt';
import request from 'request';

class AddTransactionActions {
  constructor() {
    this.generateActions(
      'addTransactionSuccess',
      'addTransactionFail',
      'emptyTx',
      'invalidPayload'
    );
  }

  addTransaction(data, txType) {
    var baseURL = window.location.protocol + "//" + window.location.host;

    var addTransactionActions = this;

    var transaction = {
      type: txType,
      data: data
    };

    request({
      url: baseURL + '/api/v0/tx',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(transaction)
    }, function(error, response, body) {
      if (response && response.statusCode === 200) {
        console.log(response);
        addTransactionActions.actions.addTransactionSuccess(response.body);
      }
      else {
        console.log(body);
        addTransactionActions.actions.addTransactionFail(body);
      }
    });
  }

}

export default alt.createActions(AddTransactionActions);