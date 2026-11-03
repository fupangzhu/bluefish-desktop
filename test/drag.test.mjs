import test from 'node:test';
import assert from 'node:assert/strict';
import drag from '../desktop/drag.cjs';
const origin={x:100,y:200,width:360,height:360},start={x:150,y:250};
test('stationary click and minor mouse jitter never move or resize the window',()=>{const d=drag.createDrag(start,origin);for(let i=0;i<100;i++){assert.equal(drag.dragBounds(d,{x:152,y:251},origin,360),null);}assert.equal(d.active,false);});
test('actual drag keeps the configured size rather than accumulated native size',()=>{const d=drag.createDrag(start,origin);assert.deepEqual(drag.dragBounds(d,{x:180,y:240},{x:100,y:200,width:386,height:390},360),{x:130,y:190,width:360,height:360});assert.equal(d.active,true);});
test('unchanged drag position is a no-op and returning to the origin still works',()=>{const d=drag.createDrag(start,origin);const next=drag.dragBounds(d,{x:180,y:240},origin,360);assert.equal(drag.dragBounds(d,{x:180,y:240},next,360),null);assert.deepEqual(drag.dragBounds(d,start,next,360),origin);});
test('stationary drag does not repeatedly chase a one-DIP native rounding difference',()=>{const d=drag.createDrag(start,origin);d.active=true;assert.equal(drag.dragBounds(d,start,{...origin,height:361},360),null);assert.deepEqual(drag.dragBounds(d,start,{...origin,height:390},360),origin);});
