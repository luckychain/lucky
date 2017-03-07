import React from 'react';
import {Grid, Row, Col, Panel, PanelGroup, Glyphicon} from 'react-bootstrap';
import { withRouter } from 'react-router';
import HomeStore from '../stores/HomeStore';
import HomeActions from '../actions/HomeActions';

class Home extends React.Component {

  constructor(props) {
    super(props);
    this.state = HomeStore.getState();
    this.onChange = this.onChange.bind(this);
  }

  componentDidMount() {
    HomeStore.listen(this.onChange);
  }

  componentWillUnmount() {
    HomeStore.unlisten(this.onChange);
  }

  onChange(state) {
    this.setState(state);
  }

  flipOrder(event) {
    event.preventDefault();
    HomeActions.flipOrder();
  }

  render() {
    var blocks = this.props.blocks;
    if (!this.state.sortDown) {
      blocks = blocks.slice().reverse();
    }
    return (
      <Grid>
        <Row>
          <Col sm={12}>
            <Panel header={(<span>Blockchain <Glyphicon glyph="sort" className='pull-right' style={{cursor:'pointer'}} onClick={this.flipOrder.bind(this)} />  </span>)}>
              <PanelGroup accordion>
                {
                  blocks.map((item) => {
                    return (
                      <Panel key={item.Hash} eventKey={item.Hash} header={"Block " + item.Hash}>
                        <p><strong>Luck:</strong> {item.Data.Luck}</p>
                        <p><strong>Time:</strong> {item.Data.Time}</p>
                        <p><strong>Miner:</strong> {item.Data.MinerId}</p>
                        <p><strong>Transactions:</strong>
                          {
                            item.Links[0].Content.Links.filter((link) => {
                              return link.Name === "transaction"
                            }).map((tx) => {
                              return (<span key={tx.Hash}>{"\n" + tx.Hash} <a href={"https://gateway.ipfs.io/api/v0/object/data/" + tx.Hash}>(View Data)</a></span>);
                            })
                          }
                        </p>
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