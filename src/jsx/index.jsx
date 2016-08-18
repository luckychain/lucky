var React = require('react');

var Row = require('react-bootstrap/lib/Row');
var Col = require('react-bootstrap/lib/Col');
var Panel = require('react-bootstrap/lib/Panel');
var PanelGroup = require('react-bootstrap/lib/PanelGroup');
var PageHeader = require('react-bootstrap/lib/PageHeader');

var Button = require('react-bootstrap/lib/Button');

var ButtonInput = require('react-bootstrap/lib/ButtonInput');
var ButtonToolbar = require('react-bootstrap/lib/ButtonToolbar');

var Form = require('react-bootstrap/lib/Form');
var FormGroup = require('react-bootstrap/lib/FormGroup');
var FormControl = require('react-bootstrap/lib/FormControl');
var ControlLabel = require('react-bootstrap/lib/ControlLabel');

var request = require('request');

var baseURL = window.location.protocol + "//" + window.location.host;

var Blockchain = React.createClass({
  getInitialState() {
    return {
      activeKey: '1',
      blocks: []
    };
  },

  componentDidMount: function() {
    this.getChain();
  },

  getChain: function() {
    var that = this;
    var url = baseURL + '/chain';
    request({
      url: url, 
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    }, function (error, response, body) {
      if (body) {
        var body = JSON.parse(body);

        var blocks = [];
        for (var i = 0; i < body.blocks.length; i++) {
          var block = body.blocks[i];
          blocks.push({ id: i, transactions: block.transactions });
        }

        that.setState({
          blocks: blocks
        });
      }
    });
  },

  handleSelect(activeKey) {
    this.setState({ activeKey });
  },

  render: function() {
    return (
      <Panel>
        <PageHeader>Blockchain</PageHeader>
        <PanelGroup activeKey={this.state.activeKey} onSelect={this.handleSelect} accordion>
          {
            this.state.blocks.map((item) => (
              <Panel header={"Block " + item.id} eventKey={item.id} key={item.id}>block data</Panel>
            ))
          }
        </PanelGroup>
      </Panel>
    );
  }
});

var Publish = React.createClass({
  getInitialState() {
    return {
      value: ''
    };
  },

  handleChange(e) {
    this.setState({ value: e.target.value });
  },

  submitTransaction: function() {
    var transaction = {
      tx: {
        Data: this.state.value
      }
    };

    var that = this;
    request({
      url: baseURL + '/tx', 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transaction)
    }, function(error, response, body) {
      if (response.statusCode === 200) {
        document.location.href = '/';
      }
    });
  },

  render: function() {
    return (
      <Panel>
        <PageHeader>Publish</PageHeader>
        <Form>
          <FormGroup controlId="formControlsTextarea">
            <ControlLabel>Transaction</ControlLabel>
            <FormControl
              type="text"
              value={this.state.value}
              componentClass="textarea"
              onChange={this.handleChange}
            />
          </FormGroup>
          <FormGroup>
            <center>
              <Button type="submit" onClick={this.submitTransaction}>
                Submit Transaction
              </Button>
            </center>
          </FormGroup>
        </Form>
      </Panel>
    );
  }
});

var Index = React.createClass({

  render: function() {
    return (
      <div className="container">
        <Col md={8} lg={8} xl={8}>
          <Blockchain />
        </Col>
        <Col md={4} lg={4} xl={4}>
          <Publish />
        </Col>
      </div>
    );
  }
});

module.exports = Index;