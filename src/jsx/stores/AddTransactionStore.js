import alt from '../alt';
import AddTransactionActions from '../actions/AddTransactionActions';

class AddTransactionStore {
    constructor() {
        this.bindActions(AddTransactionActions);
        this.name = '';
        this.helpBlock = '';
        this.txValidationState = '';
    }

    onAddTransactionSuccess(successMessage) {
        this.txValidationState = 'has-success';
        this.helpBlock = successMessage;
    }

    onAddTransactionFail(errorMessage) {
        this.txValidationState = 'has-error';
        this.helpBlock = errorMessage;
    }

    onUpdateName(event) {
        this.name = event.target.value;
        this.txValidationState = '';
        this.helpBlock = '';
    }

    onEmptyTx() {
        this.txValidationState = 'has-error';
        this.helpBlock = 'Please enter a transaction.';
    }

    onInvalidPayload() {
        this.txValidationState = 'has-error';
        this.helpBlock = 'Transaction is not in proper format.'
    }

}

export default alt.createStore(AddTransactionStore);