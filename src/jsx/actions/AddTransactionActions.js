import alt from '../alt';
import request from 'request';

class AddTransactionActions {
    constructor() {
        this.generateActions(
            'addTransactionSuccess',
            'addTransactionFail',
            'updateName',
            'emptyTx',
            'invalidPayload'
        );
    }

    addTransaction(data) {
        var baseURL = window.location.protocol + "//" + window.location.host;

        var addTransactionActions = this;

        let transaction = {
            tx: {
                Data: data
                //timestamp: Date.now()
            }
        };

        request({
          url: baseURL + '/tx', 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(transaction)
        }, function(error, response, body) {
          if (response.statusCode === 200) {
            console.log(response);
            addTransactionActions.actions.addTransactionSuccess(response.body);
          } else {
            console.log(body);
            addTransactionActions.actions.addTransactionFail(body);
          }
        });
    }

}

export default alt.createActions(AddTransactionActions);