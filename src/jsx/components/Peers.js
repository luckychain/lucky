import React from 'react';
import {Grid, Row, Col, Panel} from 'react-bootstrap';

class Peers extends React.Component {
  render() {
    return (
      <Grid>
        <Row>
          <Col sm={12}>
            <Panel header={(<span>Peers</span>)}>
              {
                this.props.peers.map((item) => {
                  return (
                    <p key={item.id}>{"Peer " + item.id}</p>
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

export default Peers;