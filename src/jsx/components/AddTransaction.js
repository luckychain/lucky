import React from 'react';
import Textarea from 'react-textarea-autosize';
import {Grid, Row, Col, Panel, FormGroup, Radio} from 'react-bootstrap';
import AddTransactionStore from '../stores/AddTransactionStore';
import AddTransactionActions from '../actions/AddTransactionActions';

class AddTransaction extends React.Component {
  constructor(props) {
    super(props);
    this.state = AddTransactionStore.getState();
    this.onChange = this.onChange.bind(this);
  }

  componentDidMount() {
    AddTransactionStore.listen(this.onChange);
  }

  componentWillUnmount() {
    AddTransactionStore.unlisten(this.onChange);
  }

  onChange(state) {
    this.setState(state);
  }

  /* Returns true if obj is defined and has content */
  validObject(obj) {
    if (obj === null || obj === undefined || obj === "") return false;
    else return true;
  }

  /* Returns true if the array of transaction links contains our defined structure */
  validTransactionPayload(txp) {
    if (!this.validObject(txp)) return false;
    else {
      if (typeof txp === "string") {
        try {
          txp = JSON.parse(txp);
        } catch(e) {
          return false;
        }
      }
      return this.validObject(txp.Data);
    }
  }

  handleSubmit(event) {
    var tx = event.target.textBox.value;
    var txType = event.target.typeOptions.value;

    event.preventDefault();

    if (!tx) {
      AddTransactionActions.emptyTx();
      this.refs.nameTextField.focus();
    //} else if (!this.validTransactionPayload(tx)) {
    //  AddTransactionActions.invalidPayload();
    } else {
      AddTransactionActions.addTransaction(tx, txType);
    }
  }


  render() {
    return (
      <Grid>
        <Row>
          <Col sm={12}>
            <Panel header="Add Transaction">
              <form onSubmit={this.handleSubmit.bind(this)}>
                <div className={'form-group ' + this.state.txValidationState}>
                  <label className='control-label'>Transaction</label>
                  <Textarea type='text' maxRows={20} className='form-control' name="textBox" ref='nameTextField' autoFocus/>
                  <span className='help-block'>{this.state.helpBlock}</span>
                </div>
                <FormGroup>
                  <Radio inline defaultChecked name="typeOptions" value="data">
                    Data
                  </Radio>
                  {'   '}
                  <Radio inline name="typeOptions" value="address">
                    IPFS Address
                  </Radio>
                </FormGroup>
                <button type='submit' className='btn btn-primary'>Submit</button>
              </form>
            </Panel>
          </Col>
        </Row>
      </Grid>
    );
  }
}

export default AddTransaction;