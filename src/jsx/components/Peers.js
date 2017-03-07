import React from 'react';
import {Grid, Row, Col, Panel, ListGroup, ListGroupItem} from 'react-bootstrap';

class Peers extends React.Component {
  render() {
    return (
      <Grid>
        <Row>
          <Col sm={12}>
            <Panel header={(<span>Peers</span>)}>
              <ListGroup>
                {
                  this.props.peers.map((item) => {
                    return (
                      <ListGroupItem key={item.id}>{item.id}</ListGroupItem>
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

export default Peers;