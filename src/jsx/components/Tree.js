import React from 'react';
import ReactDOM from 'react-dom';
//import d3 from "d3";
//import d3Tip from "d3-tip";
import Dimensions from 'react-dimensions';
var d3 = require('d3');
var d3tip = require('d3-tip')(d3);


class Tree extends React.Component {

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
        console.log(treeData);

        var margin = {top: 20, right: 120, bottom: 20, left: 120},
            width = this.props.containerWidth,
            height = 500 - margin.top - margin.bottom;

        var i = 0,
            duration = 750,
            root;

        // Cleans up the SVG on re-render
        d3.select(svgDomNode).selectAll("*").remove();

        var tree = d3.layout.tree()
            .size([height, width]);

        var diagonal = d3.svg.diagonal()
            .projection(function(d) { return [d.y, d.x]; });

        var tip = d3.tip()
            .attr('class', 'd3-tip')
            .offset([-10, 0])
            .html(function(d) {
                return "<div> <p><strong>Luck:</strong> " + d.luck +
                    "</p><p> <strong> Parent: </strong>" + d.parentHash +  "</p> <p><strong> Transactions:</strong>" +
                    d.transactions.map((tx) => {return "<span key=" + tx.hash + ">" + tx.hash + "</span>";}).join() +
                    "</p> </div>";
            });

        var vis = d3.select(svgDomNode).append("svg:svg")
            .attr("class","svg_container")
            .attr("width", width)
            .attr("height", height)
            .style("overflow", "scroll")
            .append("svg:g")
                .attr("class","drawarea")
            .append("svg:g")
                .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

        var svg = d3.select("svg");

        svg.call(tip);

        root = treeData[0];
        root.x0 = height / 2;
        root.y0 = 400;

        update(root);

        function update(source) {

            // Compute the new tree layout.
            var nodes = tree.nodes(root).reverse();

            console.log(nodes);

            // Normalize for fixed-depth.
            nodes.forEach(function(d) { d.y = d.depth * 300; });

            // Update the nodes…
            var node = vis.selectAll("g.node")
                .data(nodes, function(d) { return d.id; });

            // Enter any new nodes at the parent's previous position.
            var nodeEnter = node.enter().append("svg:g")
                .attr("class", "node")
                .attr("transform", function(d) { return "translate(" + source.y0 + "," + source.x0 + ")"; });

            nodeEnter.append("svg:circle")
                .attr("r", 1e-6)
                .style("fill", function(d) { return d._children ? "lightsteelblue" : "#fff"; })
                .on("click", click)
                //.on("dblclick", doubleClick)
                .on('mouseover', tip.show)
                .on('mouseout', tip.hide);

            nodeEnter.append("svg:text")
                .attr("x", function(d) { return 0; })
                .attr("y", function(d) { return 23; })
                .attr("dy", ".35em")
                .attr("font-size", "10px")
                .attr("text-anchor", function(d) { return "middle"; })
                .text(function(d) { return d.hash; })
                .style("fill-opacity", 1e-6);

            // Transition nodes to their new position.
            var nodeUpdate = node.transition()
                .duration(duration)
                .attr("transform", function(d) { return "translate(" + d.y + "," + d.x + ")"; });

            nodeUpdate.select("circle")
                .attr("r", 10)
                .style("fill", function(d) { return d._children ? "darkgoldenrod" : "lightsteelblue"; });

            nodeUpdate.select("text")
                .style("fill-opacity", 1);

            // Transition exiting nodes to the parent's new position.
            var nodeExit = node.exit().transition()
                .duration(duration)
                .attr("transform", function(d) { return "translate(" + source.y + "," + source.x + ")"; })
                .remove();

            nodeExit.select("circle")
                .attr("r", 1e-6);

            nodeExit.select("text")
                .style("fill-opacity", 1e-6);

            // Update the links…
            var link = vis.selectAll("path.link")
                .data(tree.links(nodes), function(d) { return d.target.id; });

            // Enter any new links at the parent's previous position.
            link.enter().insert("svg:path", "g")
                .attr("class", "link")
                .style({stroke: "black", "stroke-width": 1})
                .attr("d", function(d) {
                    var o = {x: source.x0, y: source.y0};
                    return diagonal({source: o, target: o});
                })
                .transition()
                .duration(duration)
                .attr("d", diagonal);

            // Transition links to their new position.
            link.transition()
                .duration(duration)
                .attr("d", diagonal);

            // Transition exiting nodes to the parent's new position.
            link.exit().transition()
                .duration(duration)
                .attr("d", function(d) {
                    var o = {x: source.x, y: source.y};
                    return diagonal({source: o, target: o});
                })
                .remove();

            // Stash the old positions for transition.
            nodes.forEach(function(d) {
                d.x0 = d.x;
                d.y0 = d.y;
            });

            svg.call(d3.behavior.zoom()
                .scaleExtent([0.5, 5])
                .on("zoom", zoom));
        }

        function zoom() {
            var scale = d3.event.scale,
                translation = d3.event.translate,
                tbound = -height * scale,
                bbound = height * scale,
                lbound = (-width + margin.right) * scale,
                rbound = (width - margin.left) * scale;
            // limit translation to thresholds
            translation = [
                Math.max(Math.min(translation[0], rbound), lbound),
                Math.max(Math.min(translation[1], bbound), tbound)
            ];
            d3.select(".drawarea")
                .attr("transform", "translate(" + translation + ")" +
                    " scale(" + scale + ")");
        }

        // Toggle children on click.
        function click(d) {
            if (d.children) {
                d._children = d.children;
                d.children = null;
            } else {
                d.children = d._children;
                d._children = null;
            }
            update(d);
        }

        // Toggle children on click.
        function doubleClick(d) {
            searchSubmit(d.hash);
        }

    }

    generateTooltip(item) {
        console.log(item);

        return "<div> <p><strong>Luck:</strong> " + item.luck +
            "</p> <p><strong> Transactions:</strong>" +
            item.transactions.map((tx) => {return "<span key=" + tx.hash + ">" + tx.hash + "</span>";}).join() +
            "</p> </div>";
    }


    render() {
        console.log(this.props.treeData);

        return (
            <div></div>
        );
    }
}


export default Dimensions()(Tree);