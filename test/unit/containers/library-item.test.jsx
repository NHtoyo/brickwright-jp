import LibraryItem from '../../../src/containers/library-item.jsx';

describe('library item extension selection', () => {
    test('selects Scratch-incompatible extensions without a modal confirmation', () => {
        const onSelect = jest.fn();
        const instance = new LibraryItem.WrappedComponent({
            id: 42,
            incompatibleWithScratch: true,
            onMouseEnter: jest.fn(),
            onMouseLeave: jest.fn(),
            onSelect
        });
        const preventDefault = jest.fn();
        const confirm = jest.spyOn(window, 'confirm');

        instance.handleClick({
            target: {closest: () => null},
            shiftKey: false,
            preventDefault
        });

        expect(onSelect).toHaveBeenCalledWith(42);
        expect(confirm).not.toHaveBeenCalled();
        expect(preventDefault).toHaveBeenCalled();
        confirm.mockRestore();
    });
});
