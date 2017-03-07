import React from 'react';
import ReactDOM from 'react-dom';
//import d3 from "d3";
//import d3Tip from "d3-tip";
import Dimensions from 'react-dimensions';
var d3 = require('d3');
var d3tip = require('d3-tip')(d3);


class PeerGraph extends React.Component {

  constructor(props) {
    super(props);
    this.onChange = this.onChange.bind(this);
  }

  componentDidMount() {
    this.mountNode = ReactDOM.findDOMNode(this);
    // Render the tree usng d3 after first component mount
    if(this.props.treeData){
      this.renderTree(this.props.treeData, this.mountNode, this.props.searchSubmit);
    }
  }

  shouldComponentUpdate(nextProps, nextState, handleSubmit) {
    // Delegate rendering the tree to a d3 function on prop change
    this.renderTree(nextProps.treeData, ReactDOM.findDOMNode(this));

    // Do not allow react to render the component on prop change
    return false;
  }

  onChange(state) {
    this.setState(state);
  }

  renderTree (treeData, svgDomNode, searchSubmit) {


    var margin = {top: 20, right: 120, bottom: 20, left: 120},
      width = this.props.containerWidth,
      height = 500 - margin.top - margin.bottom;

    var force = d3.layout.force()
      .gravity(.2)
      .charge(-200)
      .size([width, height]);

    var svg = d3.select("body").append("svg:svg")
      .attr("width", width)
      .attr("height", height);

    var links = d3.layout.tree().links(this.props.peersStarData);

    nodes.forEach(function(d, i) {
      d.x = width/2 + i;
      d.y = height/2 + 100 * d.depth;
    });

    root.fixed = true;
    root.x = width / 2;
    root.y = height / 2;




    force.nodes(nodes)
      .links(links)
      .start();

    var link = svg.selectAll("line")
      .data(links)
      .enter()
      .insert("svg:line")
      .attr("class", "link");

    var node = svg.selectAll("circle.node")
      .data(nodes)
      .enter()
      .append("svg:circle")
      .attr("r", 4.5)
      .attr("class", "node")
      .call(force.drag);



    force.on("tick", function(e) {

      link.attr("x1", function(d) { return d.source.x; })
        .attr("y1", function(d) { return d.source.y; })
        .attr("x2", function(d) { return d.target.x; })
        .attr("y2", function(d) { return d.target.y; });

      node.attr("cx", function(d) { return d.x; })
        .attr("cy", function(d) { return d.y; });

    });

  }

  render() {
    console.log(this.props.treeData);

    return (
      <div></div>
    );
  }
}


export default Dimensions()(PeerGraph);

