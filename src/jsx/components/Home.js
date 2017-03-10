import React from 'react';
import {Grid, Row, Col, Panel, PanelGroup, ListGroup, ButtonToolbar} from 'react-bootstrap';
import {withRouter} from 'react-router';
import InfiniteScroll from 'react-infinite-scroller';
import AppActions from '../actions/AppActions';
import Transaction from './Transaction';

class Home extends React.Component {
  loadBlocks(page) {
    AppActions.getChain(page * 100);
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
    var loader = <div className="loader">Loading ...</div>;

    return (
      <Grid>
        <Row>
          <Col sm={12}>
            <Panel className={this.props.blocks.length ? 'not-empty' : ''} header={(<h4>Blocks</h4>)}>
              <InfiniteScroll pageStart={0} loadMore={this.loadBlocks.bind(this)} hasMore={this.props.blocksHasMore} loader={loader}>
                <PanelGroup accordion>
                  {
                    this.props.blocks.map((item) => {
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
                          <strong>Block luck:</strong> {item.Data.Luck}<br/>
                          <strong>Block miner:</strong> {item.Data.MinerId}<br/>
                          <strong>Chain luck:</strong> {item.Data.ChainLuck}<br/>
                          <strong>Chain length:</strong> {item.Data.ChainLength}<br/>
                          {this.renderTransactions(transactions)}
                        </Panel>
                      );
                    })
                  }
                </PanelGroup>
              </InfiniteScroll>
            </Panel>
          </Col>
        </Row>
      </Grid>
    );
  }
}

export default withRouter(Home);