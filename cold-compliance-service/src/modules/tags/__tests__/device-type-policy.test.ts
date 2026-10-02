import assert from 'node:assert/strict';
import test from 'node:test';
import { HardwareDevice,isOperationalB5 } from '../hardware-manager.client';
const device: HardwareDevice={id:1,name:'B5',description:null,ble_mac:'ABCDEF000001',company_id:'fixture',device_type:'b5',active:true,status:'active',type_policy:{known:true,typeActive:true,companyAllowed:true,horneoCompatible:true}};
test('existing B5 remains operational when catalog is deactivated',()=>assert(isOperationalB5({...device,type_policy:{...device.type_policy!,typeActive:false}})));
test('permitted new type cannot acquire B5 protocol or compatibility',()=>assert(!isOperationalB5({...device,device_type:'new_sensor',type_policy:{...device.type_policy!,horneoCompatible:false}})));
test('policy missing, rejected and inactive/status remain independent',()=>{
  assert(!isOperationalB5({...device,type_policy:undefined}));
  assert(!isOperationalB5({...device,type_policy:{...device.type_policy!,companyAllowed:false}}));
  assert(!isOperationalB5({...device,active:false}));assert(!isOperationalB5({...device,status:'maintenance'}));
});
