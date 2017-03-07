import React from 'react';
import {Grid, Row, Col, Panel, PanelGroup, Glyphicon, ListGroup, ButtonToolbar} from 'react-bootstrap';
import {withRouter} from 'react-router';
import AppActions from '../actions/AppActions';
import Transaction from './Transaction';

class Home extends React.Component {
  flipOrder(event) {
    event.preventDefault();
    AppActions.flipOrder();
  }

  renderTransactions(transactions) {
    var transactionsElements;
    if (transactions.length) {
      transactionsElements = [
        <strong key="transactions">Transactions:</strong>
      ,
        <ListGroup key="transactions-group" className="transactions">
          {
            transactions.map((item) => {
              return (
                <Transaction key={item.Hash} transaction={item} />
              );
            })
          }
        </ListGroup>
      ]
    }
    else {
      transactionsElements = (
        <strong>No transactions</strong>
      )
    }
    return transactionsElements;
  }

  render() {
    var blocks = this.props.blocks;
    if (!this.props.sortDown) {
      blocks = blocks.slice().reverse();
    }
    return (
      <Grid>
        <Row>
          <Col sm={12}>
            <Panel header={(<h4>Blockchain<Glyphicon glyph="sort" className='pull-right order-button' onClick={this.flipOrder.bind(this)} /></h4>)}>
              <PanelGroup accordion>
                {
                  blocks.map((item) => {
                    var transactions = item.Links[0].Content.Links.filter((link) => {
                      return link.Name === "transaction"
                    });

                    var transactionsCount = transactions.length === 1 ? "1 transaction" : `${transactions.length} transactions`;

                    return (
                      <Panel key={item.Hash} eventKey={item.Hash} header={(<h5>{item.Hash} ({transactionsCount}) <span className='pull-right'>{item.Data.Time}</span></h5>)}>
                        <ButtonToolbar className="pull-right">
                          <a href={"https://gateway.ipfs.io/api/v0/object/get/" + item.Hash} className="btn btn-default btn-xs">Block Get</a>
                          <a href={"https://gateway.ipfs.io/api/v0/object/stat/" + item.Hash} className="btn btn-default btn-xs">Block Stat</a>
                          <a href={"https://gateway.ipfs.io/api/v0/object/get/" + item.Links[0].Hash} className="btn btn-default btn-xs">Payload Get</a>
                          <a href={"https://gateway.ipfs.io/api/v0/object/stat/" + item.Links[0].Hash} className="btn btn-default btn-xs">Payload Stat</a>
                        </ButtonToolbar>
                        <strong>Luck:</strong> {item.Data.Luck}<br/>
                        <strong>Miner:</strong> {item.Data.MinerId}<br/>
                        {this.renderTransactions(transactions)}
                      </Panel>
                    );
                  })
                }
              </PanelGroup>
            </Panel>
          </Col>
        </Row>
      </Grid>
    );
  }
}

export default withRouter(Home);