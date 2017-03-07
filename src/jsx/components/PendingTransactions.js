import React from 'react';
import {Grid, Row, Col, Panel, ListGroup} from 'react-bootstrap';
import Transaction from './Transaction';

class PendingTransactions extends React.Component {
  render() {
    return (
      <Grid>
        <Row>
          <Col sm={12}>
            <Panel header={(<span>Pending Transactions</span>)}>
              <ListGroup>
                {
                  this.props.transactions.map((item) => {
                    return (
                      <Transaction key={item.Hash} transaction={item} />
                    );
                  })
                }
              </ListGroup>
            </Panel>
          </Col>
        </Row>
      </Grid>
    );
  }
}

export default PendingTransactions;