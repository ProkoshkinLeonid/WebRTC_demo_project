import {useRef} from "react";

export function useJanusVideoroom() {
    const pluginRef = useRef(null)

    async function attachPlugin(janusInstance){
        if(!janusInstance) throw new Error('Janus instance required')
        if(pluginRef.current) {
            console.log('🔄 Plugin already attached, reusing');
            return pluginRef.current;
        }

        return await new Promise((resolve, reject) => {
            janusInstance.attach({
                plugin: 'janus.plugin.videoroom',
                success: function(handle){
                    console.log('✅ Plugin attached successfully, handle ID:', handle.getId());
                    pluginRef.current = handle;
                    resolve(handle)
                },
                error: function(err){
                    console.error('❌ Plugin attach error:', err);
                    reject(err)
                }
            })
        })
    }

    function detach(){
        if(pluginRef.current){
            try{
                pluginRef.current.detach();
                console.log('✅ Plugin detached');
            } catch(e) {
                console.error('Detach error:', e);
            }
            pluginRef.current = null;
        }
    }

    return { attachPlugin, detach, pluginHandle: pluginRef.current }
}