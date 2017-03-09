import React from 'react';
import Textarea from 'react-textarea-autosize';
import {Grid, Row, Col, Panel, FormGroup, Radio} from 'react-bootstrap';
import AppActions from '../actions/AppActions';

class AddTransaction extends React.Component {
  handleSubmit(event) {
    event.preventDefault();

    var type = event.target.transactionType.value;
    var data = event.target.transactionData.value;

    if (!data) {
      AppActions.emptyTransaction();
      this.refs.transactionDataField.focus();
    }
    else {
      AppActions.addTransaction(type, data);
    }
  }

  render() {
    return (
      <Grid>
        <Row>
          <Col sm={12}>
            <Panel header={(<h4>Add Transaction</h4>)}>
              <form onSubmit={this.handleSubmit.bind(this)}>
                <div className={'form-group ' + this.props.addTransactionState}>
                  <label className="control-label">Transaction</label>
                  <Textarea type="text" maxRows={20} className="form-control" name="transactionData" ref="transactionDataField" autoFocus />
                  <span className="help-block">{this.props.addTransactionHelp}</span>
                </div>
                <FormGroup>
                  <Radio inline defaultChecked name="transactionType" value="data">
                    Data
                  </Radio>
                  {'   '}
                  <Radio inline name="transactionType" value="address">
                    IPFS Address
                  </Radio>
                </FormGroup>
                <button type="submit" className="btn btn-primary">Submit</button>
              </form>
            </Panel>
          </Col>
        </Row>
      </Grid>
    );
  }
}

export default AddTransaction;