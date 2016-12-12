var React = require('react');

var Navbar = require('react-bootstrap/lib/Navbar');

var Navigation = React.createClass({
  render: function () {
    return (
      <Navbar brand={<a href="/">luckychain</a>} toggleNavKey={0} fluid={true} inverse>
      </Navbar>
    );
  }
});

module.exports = Navigation;