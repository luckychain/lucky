import React from 'react';
import {Grid, Row, Col, Panel} from 'react-bootstrap';

class PendingTransactions extends React.Component {
  render() {
    return (
      <Grid>
        <Row>
          <Col sm={12}>
            <Panel header={(<span>Pending Transactions</span>)}>
              {
                this.props.transactions.map((item) => {
                  return (
                    <p key={item.Hash}>{"Transaction " + item.Hash + " (" + item.Size + " B)"}</p>
                  );
                })
              }
            </Panel>
          </Col>
        </Row>
      </Grid>
    );
  }
}

export default PendingTransactions;