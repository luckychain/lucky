import alt from '../alt';
import 'whatwg-fetch';

class AddTransactionActions {
  constructor() {
    this.generateActions(
      'addTransactionSuccess',
      'addTransactionFail',
      'emptyTx'
    );
  }

  addTransaction(type, data) {
    fetch('/api/v0/tx', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: type,
        data: data
      })
    }).then((response) => {
      if (response.status === 200) {
        return response.text();
      }
      else {
        return response.text().then((text) => {
          throw new Error(text);
        });
      }
    }).then((text) => {
      this.actions.addTransactionSuccess(text);
    }).catch((error) => {
      this.actions.addTransactionFail(`${error}`);
    });
  }
}

export default alt.createActions(AddTransactionActions);