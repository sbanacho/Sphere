// Copyright 2013 Scott Banachowski
//
//  This program is free software: you can redistribute it and/or modify it
//  under the terms of the GNU Affero General Public License, version 3, as
//  published by the Free Software Foundation.
//
//  This program is distributed in the hope that it will be useful, but WITHOUT
//  ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
//  FITNESS FOR A PARTICULAR PURPOSE.
//
//  See <http://www.gnu.org/licenses/agpl.txt>
//


function Tag(title) {
    this.title = title;
    this.slug = "";
}

function getTopTags(categories) {
    categories.sort(function(a, b) { return b.post_count - a.post_count; });
    var i;
    var tags = [];
    var mapById = {};
    
    // Categories may be nested, need to recursively build path.
    function getSlug(map, category) {
        var prefix = "";
        // Parent of 0 means no parent.
        if (category["parent"] > 0) {
            prefix = getSlug(map, map[category["parent"]]) + '/';
        }
        return prefix + category.slug;
    }

    // First pass, build title, map ids to categories.
    for (i = 0; i < categories.length; i++) {
        tags.push(new Tag(categories[i].title));
        mapById[categories[i].id] = categories[i];
    }
    // Second pass, build slug.
    for (i = 0; i < categories.length; i++) {
        tags[i].slug = getSlug(mapById, categories[i]);
    }

    return tags;
}

// Stores a 3-D point, used as either a position on a sphere,
// or a vector of rotation angles.
function ThreeD(x, y, z) {
    this.set = function(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
    };

    this.set(x, y, z);

    this.clone = function() {
        return new ThreeD(this.x, this.y, this.z);
    };

    this.add = function(other) {
        this.x += other.x;
        this.y += other.y;
        this.z += other.z;
    };
}

// Like ThreeD but less.
function TwoD(x, y) {
    this.x = x;
    this.y = y;
}

// Rotator is used to rotate a position on the surface of the sphere
// by a rotation angle, which is a ThreeD vector.
function Rotator(rotationAngle) {

    // All the points on the surface of the sphere will be rotated together.
    // Precompute the trig functions so they may be reused for each point.
    var sx = Math.sin(rotationAngle.x);
    var cx = Math.cos(rotationAngle.x);
    var sy = Math.sin(rotationAngle.y);
    var cy = Math.cos(rotationAngle.y);
    var sz = Math.sin(rotationAngle.z);
    var cz = Math.cos(rotationAngle.z);

    // Rotate the ThreeD input point, storing the new position into the
    // ThreeD output.
    this.rotate = function(input, output) {
        // rotate around x
        var xy = cx * input.y - sx * input.z;
        var xz = sx * input.y + cx * input.z;
        // rotate around y
        var yz = cy * xz - sy * input.x;
        var yx = sy * xz + cy * input.x;
        // rotate around z
        var zx = cz * yx - sz * xy;
        var zy = sz * yx + cz * xy;

        // Save the output into an exisiting point instead of
        // returning a new one to save memory allocations.
        output.set(zx, zy, yz);
    };
}

// Stores all the information associated with a slot, which
// represents one position on the sphere.
function Slot(phi, tag, rank, total) {
    var homeZ = (2.0 * (total - rank) / total) - 1.0;

    function zAndPhiToPoint(z, phi) {
        var theta = Math.acos(z);
        return new ThreeD(
                Math.sin(theta) * Math.cos(phi),
                Math.sin(theta) * Math.sin(phi),
                z);
    }

    this.tag = tag;
    this.homePosition = zAndPhiToPoint(homeZ, phi);
    this.currentPosition = this.homePosition.clone();

    this.canvasPosition = new TwoD(0, 0);
    this.halfHeight = 0;
    this.halfWidth = 0;

    this.rotate = function(rotator) {
        rotator.rotate(this.homePosition, this.currentPosition);
    };

    this.setCanvasPosition = function(x, y, height, width) {
        this.canvasPosition.x = x;
        this.canvasPosition.y = y;
        this.halfHeight = height / 2;
        this.halfWidth = width / 2;
    };

    this.isPointIn = function(point) {
        return (Math.abs(point.x - this.canvasPosition.x) < this.halfWidth) &&
                (Math.abs(point.y - this.canvasPosition.y) < this.halfHeight);
    };
}

function sphereContext() {
    this.size = document.getElementById("sphereDiv").offsetWidth;
    this.canvas = document.getElementById('sphere');

    this.context = (function(d, canvas) {
        var canvasContext = canvas.getContext('2d');

        canvas.width = d;
        canvas.height = d;

        canvasContext.textBaseline = 'middle';
        canvasContext.textAlign = 'center';

        return canvasContext;
    } (this.size, this.canvas));

    this.gradient = (function(rad, context) {
        var shadowCenter = rad * 0.75;
        var shadowRadius = rad * 0.10;

        var radgrad = context.createRadialGradient(
                shadowCenter, shadowCenter, shadowRadius,
                rad, rad, rad);

        radgrad.addColorStop(0, '#FFFFFF');
        radgrad.addColorStop(0.9, '#BBEEFF');
        radgrad.addColorStop(1, '#FFFFFF');

        return radgrad;
    } (this.size / 2, this.context));

    this.reset = function() {
        this.context.globalAlpha = 1.0;
        this.context.fillStyle = this.gradient;
        this.context.fillRect(0, 0, this.size, this.size);
    };
}

function sphere(tags, context) {
    // The sphere is slightly smaller than the canvas size.  Calculate
    // the radius of the sphere.
    var scaleFactor = 0.75;
    var radius = scaleFactor * context.size / 2;

    // Offset is the X and Y offset of the upper-left corner of
    // the square that bounds the sphere inside the canvas.
    var offset = (1.0 - scaleFactor) * context.size / 2.0;

    // Set up various constants.  Many of these are used inside loops, so
    // the are cached here to avoid recomputing.
    var framesPerSecond = 20;

    // These control the rate at which the sphere wobbles:
    // The time before a dimension should drift back to its original position.
    var secondsToFullyOscillate = 10;
    // This bounds how far from its original position the sphere can wobble.
    var driftMaxRotation = 10 * Math.PI / 180;
    // Convert the drift rate to a step size to take during each frame.
    // There's a slightly different rate in each angle to make the drift more wobbly.
    var driftOscillationStep = new ThreeD(
            2 * Math.PI / (framesPerSecond * secondsToFullyOscillate),
            2 * Math.PI / (framesPerSecond * (secondsToFullyOscillate + 1)),
            2 * Math.PI / (framesPerSecond * (secondsToFullyOscillate - 1)));

    // Controls how fast the dragged sphere will return to its original position.
    var dragReturnFactor = framesPerSecond * 10;
    // This effects how far mouse dragging will move the sphere.
    var dragFactor = Math.PI / (32 * radius);

    // Controls the size of text.  Larger scale factor results in larger text.
    var fontScaleFactor = 20;
    var minimumFontSize = 10;

    // Variables that control how far the sphere has shifted due to wobble and drag.
    var driftOscillation = new ThreeD(0, 0, 0);
    var driftRotation = new ThreeD(0, 0, 0);
    var dragRotation = new ThreeD(0, 0, 0);

    // Set to a TwoD point when a drag is in action, or null when a drag
    // is not in action.
    var dragStart = null;
    // Measure how far a drag went to distinguish from click.
    var peakDragDistance = null;

    // This is a highlighted slot, set to null if none are.
    var highlighted = null;

    var slots = (function(maxSlots) {
        var howMany = Math.min(tags.length, maxSlots);
        var phi = -Math.PI;
        var phiStep = 3 * (2.0 * Math.PI) / howMany;
        var newSlots = [];
        var i;
        for (i = 0; i < howMany; i++) {
            newSlots[i] = new Slot(phi, tags[i], i, howMany);
            phi = phi + phiStep;
        }
        return newSlots;
    } (50));


    function onMouseDown(ev) {
        dragStart = new TwoD(ev.clientX, ev.clientY);
        peakDragDistance = new TwoD(0, 0);
    }

    function onMouseUp(ev) {
        dragStart = null;
    }

    // Get the mouse coordinates relative to the canvas.
    function getMouseCoordinates(ev) {
        // This works in chrome:
        if (ev.offsetX && ev.offsetY) {
             return new TwoD(ev.offsetX, ev.offsetY);
        }
        // This works in firefox or chrome:
        return new TwoD(ev.layerX - context.canvas.offsetLeft,
                    ev.layerY - context.canvas.offsetTop);
    }

    function highlightUnderMouse(ev) {
        var i;
        var pos = getMouseCoordinates(ev);
        highlighted = null;
        for (i = 0; i < slots.length; i++) {
            if (slots[i].isPointIn(pos)) {
                if (highlighted == null || (slots[i].z > highlighted.z)) {
                    highlighted = slots[i];
                }
            }
        }
    }

    function onMouseMove(ev) {
        // If the mouse is just moving (but not dragging), highlight
        // a link that the cursor is over.
        if (dragStart == null) {
            highlightUnderMouse(ev);
            return;
        }

        // If dragging, compute how far the sphere should move, which
        // is relative to where the drag started.
        var offsetX = ev.clientX - dragStart.x;
        var offsetY = ev.clientY - dragStart.y;
        dragRotation.y += (offsetX * dragFactor);
        dragRotation.x -= (offsetY * dragFactor);

        // Save the peak drag, for click measurement.
        if (Math.abs(offsetX) > peakDragDistance.x) {
            peakDragDistance.x = Math.abs(offsetX);
        }
        if (Math.abs(offsetY) > peakDragDistance.y) {
            peakDragDistance.y = Math.abs(offsetY);
        }
    }

    function onClick(ev) {
        // Distinguish between drags and clicks.  Only clicks open links.
        if (peakDragDistance.x > 2 || peakDragDistance.y > 2) {
        }
        else if (highlighted != null) {
            location.href = "http://banachowski.com/deprogramming/category/"
                    + highlighted.tag.slug;
        }
    }

    function onMouseOut(ev) {
        dragStart = null;
        highlighted = null;
    }

    function restoreDragRotation() {
        if (Math.abs(dragRotation.x) > 0) {
            dragRotation.x -= (dragRotation.x / dragReturnFactor);
        }
        if (Math.abs(dragRotation.y) > 0) {
            dragRotation.y -= (dragRotation.y / dragReturnFactor);
        }
    }

    function updateDriftRotation() {
        driftOscillation.add(driftOscillationStep);
        driftRotation.x = Math.sin(driftOscillation.x) * driftMaxRotation;
        driftRotation.y = Math.sin(driftOscillation.y) * driftMaxRotation;
        driftRotation.z = Math.sin(driftOscillation.z) * driftMaxRotation;
    }

    function rotatePoints(rotationAngle) {
        var i;
        var r = new Rotator(rotationAngle);
        for (i = 0; i < slots.length; i++) {
            slots[i].rotate(r);
        }
    }

    function drawEntry(entry) {
        var pos = entry.currentPosition;

        var alpha = (pos.z + 1) / 2;
        var fontSize = alpha * fontScaleFactor + minimumFontSize;

        var x = offset + (radius * (pos.x + 1));
        var y = offset + (radius * (pos.y + 1));

        context.context.globalAlpha = alpha;
        context.context.font = fontSize + 'px sans-serif';

        if (entry == highlighted) {
            context.context.fillStyle  = '#0000FF';
        } else {
            context.context.fillStyle  = '#FF0000';
        }

        context.context.fillText(entry.tag.title, x, y);

        // Save the canvas location for click-checking.
        var metrics = context.context.measureText(entry.tag.title);
        entry.setCanvasPosition(x, y, fontSize, metrics.width);
    }

    function draw() {
        var i;
        context.reset();
        for (i = 0; i < slots.length; i++) {
            drawEntry(slots[i]);
        }
    }

    function onInterval() {
        restoreDragRotation();
        updateDriftRotation();
        var totalRotation = driftRotation.clone();
        totalRotation.add(dragRotation);
        rotatePoints(totalRotation);
        draw();
    }
    
    context.canvas.addEventListener("mousemove", onMouseMove, false);
    context.canvas.addEventListener("mousedown", onMouseDown, false);
    context.canvas.addEventListener("mouseup", onMouseUp, false);
    context.canvas.addEventListener("mouseout", onMouseOut, false);
    context.canvas.addEventListener("click", onClick, false);

    // This kicks things off:
    draw();
    setInterval(onInterval, 1000/framesPerSecond);
}

function loadSphere(jsonObj, context) {
    var tags = getTopTags(jsonObj.categories);
    // It seems to work if waiting for the load or just starting it right
    // away, so for now just do the former.
    sphere(tags, context);
    // or switch to this to do the latter
    // window.addEventListener('load', function() { sphere(tags) } , false);
}

function kickSphere() {
    var context = new sphereContext();
    var key = '_' + + new Date;
    var script = document.createElement('script');
    var head = document.getElementsByTagName('head')[0] 
            || document.documentElement;

    context.reset();
    window[key] = function(jsonObj) {
        head.removeChild(script);
        loadSphere(jsonObj, context);
    };

    script.src = "http://banachowski.com/deprogramming/"
            + "?json=get_category_index&callback=" + key;
    head.appendChild(script);
}

kickSphere();
