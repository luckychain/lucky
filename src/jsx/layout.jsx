var React = require('react');

var Navigation = require('./navigation.jsx');
var Index = require('./index.jsx');

var Layout = React.createClass({
  renderPath: function () {
    if (this.props.pathname === "/") {
      return <Index />;
    }
  },

  render: function () {
    return (
      <div>
        <Navigation pathname={this.props.pathname} />
        {this.renderPath()}
      </div>
    );
  }
});

module.exports = Layout;