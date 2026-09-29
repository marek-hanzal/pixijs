import { GpuUniformBatchPipe } from '../gpu/GpuUniformBatchPipe';
import { BindGroup } from '../gpu/shader/BindGroup';
import { Texture } from '../shared/texture/Texture';
import { getWebGPURenderer, itLocalOnly } from '@test-utils';
import { AlphaFilter, BlurFilter } from '~/filters';
import { Container, Graphics, Sprite } from '~/scene';

import type { WebGPURenderer } from '../gpu/WebGPURenderer';

function createUniformBatchPipe(): GpuUniformBatchPipe
{
    return new GpuUniformBatchPipe({} as WebGPURenderer);
}

describe('UniformBatch', () =>
{
    afterEach(() => jest.restoreAllMocks());

    it('should get a bind group correctly', () =>
    {
        const uniformBatchPipe = createUniformBatchPipe();

        const bufferResource = uniformBatchPipe.getArrayBufferResource(new Float32Array(32));

        expect(bufferResource.buffer).toBe(uniformBatchPipe['_buffers'][0]);
        expect(bufferResource.offset).toBe(0);

        const bufferResource2 = uniformBatchPipe.getArrayBufferResource(new Float32Array(32));

        expect(bufferResource2.buffer).toBe(uniformBatchPipe['_buffers'][1]);
        expect(bufferResource2.offset).toBe(0);

        const bufferResource3 = uniformBatchPipe.getArrayBufferResource(new Float32Array(32));

        expect(bufferResource3.buffer).toBe(uniformBatchPipe['_buffers'][0]);
        expect(bufferResource3.offset).toBe(256);
    });

    it('should release its buffer resources from other bind groups without a warning when destroyed', () =>
    {
        const uniformBatchPipe = createUniformBatchPipe();
        const resource = uniformBatchPipe.getArrayBufferResource(new Float32Array(4));
        const holder = new BindGroup({ 0: resource });
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        uniformBatchPipe.destroy();

        expect(warnSpy).not.toHaveBeenCalled();
        expect(holder.getResource(0)).toBeNull();
    });

    it('should still warn when a buffer resource it handed out is destroyed directly', () =>
    {
        const uniformBatchPipe = createUniformBatchPipe();
        const resource = uniformBatchPipe.getArrayBufferResource(new Float32Array(4));
        const holder = new BindGroup({ 0: resource });
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        resource.destroy();

        expect(warnSpy).toHaveBeenCalledTimes(1);

        const [warningArgs] = warnSpy.mock.calls;

        expect(warningArgs.join(' ')).toContain(`a 'bufferResource' was destroyed while still bound to a shader`);
        expect(holder.getResource(0)).toBeNull();
    });

    itLocalOnly('should not warn about buffer resources when a WebGPU renderer that ran filters is destroyed', async () =>
    {
        const renderer = await getWebGPURenderer();
        const stage = new Container();
        const alphaSprite = stage.addChild(new Sprite(Texture.WHITE));
        const blurSprite = stage.addChild(new Sprite(Texture.WHITE));

        alphaSprite.filters = [new AlphaFilter()];
        blurSprite.filters = [new BlurFilter()];

        renderer.render(stage);

        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        renderer.destroy();

        const bufferResourceWarnings = warnSpy.mock.calls.filter((args) => args.join(' ').includes(`'bufferResource'`));

        expect(bufferResourceWarnings).toHaveLength(0);
    });

    itLocalOnly('should submit one command buffer per render', async () =>
    {
        const renderer = await getWebGPURenderer();
        const container = new Container();
        const spy = jest.spyOn(renderer.gpu.device.queue, 'submit');

        try
        {
            // the global uniforms take slot 0 and each no-batch graphics takes the next, so the first graphics
            // is in slot 1 and every render has to write the shifted buffer
            for (let i = 0; i < 2; i++)
            {
                const graphics = new Graphics().rect(i * 20, 0, 10, 10).fill('red');

                graphics.context.batchMode = 'no-batch';
                container.addChild(graphics);
            }

            // count the second render only, so setup that runs once on the first render can't change the count
            renderer.render(container);
            spy.mockClear();

            renderer.render(container);

            expect(spy).toHaveBeenCalledTimes(1);
        }
        finally
        {
            spy.mockRestore();
            container.destroy({ children: true });
            renderer.destroy();
        }
    });
});
