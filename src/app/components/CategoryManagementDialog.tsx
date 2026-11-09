import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Plus, Loader2, Tag } from 'lucide-react';
import { useOrgServices } from '@/hooks/useOrgServices';

interface CategoryManagementDialogProps {
  onCategoryCreated?: () => void;
}

const CATEGORY_COLORS = [
  { value: '#3b82f6', label: 'Blue' },
  { value: '#10b981', label: 'Green' },
  { value: '#f59e0b', label: 'Orange' },
  { value: '#ef4444', label: 'Red' },
  { value: '#8b5cf6', label: 'Purple' },
  { value: '#ec4899', label: 'Pink' },
  { value: '#06b6d4', label: 'Cyan' },
  { value: '#84cc16', label: 'Lime' },
];

const CATEGORY_ICONS = [
  'tag',
  'briefcase',
  'shopping-cart',
  'home',
  'car',
  'utensils',
  'coffee',
  'heart',
];

export function CategoryManagementDialog({ onCategoryCreated }: CategoryManagementDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    type: 'expense' as 'income' | 'expense',
    accountId: 'default',
    color: '#3b82f6',
    icon: 'tag',
  });

  const { categories } = useOrgServices();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await categories.create({
        name: formData.name,
        type: formData.type,
        accountId: formData.accountId,
        color: formData.color,
        icon: formData.icon,
        patterns: [],
      });

      if (result.success) {
        alert(`✅ Category "${formData.name}" created successfully!`);
        setFormData({
          name: '',
          type: 'expense',
          accountId: 'default',
          color: '#3b82f6',
          icon: 'tag',
        });
        setOpen(false);
        onCategoryCreated?.();
      } else {
        alert(`❌ Error: ${result.error || 'Failed to create category'}`);
      }
    } catch (error) {
      alert('❌ An unexpected error occurred');
      console.error('Category creation error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-cyan-500 hover:bg-cyan-600">
          <Plus className="size-4 mr-2" />
          Add Category
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] bg-slate-900 border-slate-800">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Tag className="size-5 text-cyan-400" />
              Create New Category
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Add a new category to organize your transactions. The AI will learn to automatically classify similar transactions.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name" className="text-slate-300">
                Category Name
              </Label>
              <Input
                id="name"
                placeholder="e.g., Software & Tools"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                className="bg-slate-950 border-slate-700 text-white"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="type" className="text-slate-300">
                Type
              </Label>
              <Select
                value={formData.type}
                onValueChange={(value: 'income' | 'expense') =>
                  setFormData({ ...formData, type: value })
                }
              >
                <SelectTrigger className="bg-slate-950 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800">
                  <SelectItem value="expense" className="text-white">
                    Expense
                  </SelectItem>
                  <SelectItem value="income" className="text-white">
                    Income
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="color" className="text-slate-300">
                Color
              </Label>
              <Select
                value={formData.color}
                onValueChange={(value) => setFormData({ ...formData, color: value })}
              >
                <SelectTrigger className="bg-slate-950 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800">
                  {CATEGORY_COLORS.map((color) => (
                    <SelectItem key={color.value} value={color.value} className="text-white">
                      <div className="flex items-center gap-2">
                        <div
                          className="size-4 rounded-full"
                          style={{ backgroundColor: color.value }}
                        />
                        {color.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="icon" className="text-slate-300">
                Icon
              </Label>
              <Select
                value={formData.icon}
                onValueChange={(value) => setFormData({ ...formData, icon: value })}
              >
                <SelectTrigger className="bg-slate-950 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800">
                  {CATEGORY_ICONS.map((icon) => (
                    <SelectItem key={icon} value={icon} className="text-white capitalize">
                      {icon.replace('-', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !formData.name.trim()}
              className="bg-cyan-500 hover:bg-cyan-600"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="size-4 mr-2" />
                  Create Category
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
