import React from 'react';
import {Grid, Row, Col, Panel, PanelGroup, Glyphicon, ListGroup} from 'react-bootstrap';
import {withRouter} from 'react-router';
import AppActions from '../actions/AppActions';
import Transaction from './Transaction';

class Home extends React.Component {
  flipOrder(event) {
    event.preventDefault();
    AppActions.flipOrder();
  }

  renderTransactions(block) {
    var transactions = block.Links[0].Content.Links.filter((link) => {
      return link.Name === "transaction"
    });
    var transactionsElements;
    if (transactions.length) {
      transactionsElements = [
        <strong>Transactions:</strong>
      ,
        <ListGroup className="transactions">
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
                    return (
                      <Panel key={item.Hash} eventKey={item.Hash} header={(<h5>{item.Hash}<span className='pull-right'>{item.Data.Time}</span></h5>)}>
                        <strong>Luck:</strong> {item.Data.Luck}<br/>
                        <strong>Miner:</strong> {item.Data.MinerId}<br/>
                        {this.renderTransactions(item)}
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